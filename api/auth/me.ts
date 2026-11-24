import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getAuth, UnauthorizedError } from '../../lib/auth';
import { getPool } from '../../lib/db';
import { userToMe, adminUserToJson } from '../../lib/mappers';
import { loadResources } from '../../lib/bootstrap';
import { sendJson } from '../../lib/respond';

const profileSchema = z.object({
  name: z.string().min(1).optional(),
  title: z.string().optional(),
  regNumber: z.string().max(80).optional(),
  signature: z.string().max(300000).optional(), // data URL (imagem comprimida no cliente)
});

// Nomes dos campos no JSON (camelCase) → coluna no Postgres (snake_case).
const PROFILE_COLUMNS: Record<string, string> = {
  name: 'name',
  title: 'title',
  regNumber: 'reg_number',
  signature: 'signature',
};

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().trim().min(6, 'Senha precisa ter pelo menos 6 caracteres'),
});

const pushSubSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

const adminCreateUpdateSchema = z.object({
  userId: z.string().uuid(),
  accessType: z.enum(['monthly', 'annual', 'unlimited']),
  accessUntil: z.string().datetime().optional(),
});

async function requireAdmin(pool: ReturnType<typeof getPool>, userId: string) {
  const r = await pool.query('select role from users where id = $1', [userId]);
  if (r.rows[0]?.role !== 'admin') throw new UnauthorizedError('forbidden');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = getAuth(req);
    const pool = getPool();

    // Painel admin: lista as contas de clientes (ver PLANO de acesso pago).
    // Reaproveita este arquivo em vez de uma function nova (limite de 12 no Hobby).
    if (req.method === 'GET' && req.query.action === 'admin-list') {
      await requireAdmin(pool, auth.userId);
      const result = await pool.query(
        `select * from users where role <> 'admin' order by created_at desc`
      );
      return res.status(200).json(result.rows.map(adminUserToJson));
    }

    if (req.method === 'GET') {
      const result = await pool.query(
        `select id, email, name, title, reg_number, signature, email_verified_at,
                role, access_type, access_until, must_change_password
         from users where id = $1`,
        [auth.userId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
      const me = userToMe(result.rows[0]);

      // ?full=1: devolve perfil + todos os recursos numa chamada só, em vez de
      // 7 (perfil, places, patients, insurers, appts, exceptions, records).
      // Cada chamada é uma invocação de função separada — isso soma bastante,
      // principalmente no `vercel dev` local, que não paraleliza bem várias
      // invocações ao mesmo tempo.
      if (req.query.full !== '1') return res.status(200).json(me);
      return sendJson(req, res, 200, { me, ...(await loadResources(auth.userId)) });
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      // Trocar senha: ?action=password no body {currentPassword, newPassword}
      if (req.query.action === 'password') {
        const parsed = passwordSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
        }
        const { currentPassword, newPassword } = parsed.data;
        const result = await pool.query('select password_hash from users where id = $1', [auth.userId]);
        if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
        const ok = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!ok) return res.status(401).json({ error: 'wrong_password' });
        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query(
          'update users set password_hash = $1, must_change_password = false where id = $2',
          [newHash, auth.userId]
        );
        return res.status(200).json({ ok: true });
      }

      // Admin ajusta o prazo/tipo de acesso de uma conta de cliente.
      if (req.query.action === 'admin-update') {
        await requireAdmin(pool, auth.userId);
        const parsed = adminCreateUpdateSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
        const { userId, accessType, accessUntil } = parsed.data;
        if (accessType !== 'unlimited' && !accessUntil) {
          return res.status(400).json({ error: 'invalid_input', message: 'accessUntil é obrigatório para esse tipo de acesso' });
        }
        const result = await pool.query(
          `update users set access_type = $1, access_until = $2
           where id = $3 and role <> 'admin' returning *`,
          [accessType, accessType === 'unlimited' ? null : accessUntil, userId]
        );
        if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
        return res.status(200).json(adminUserToJson(result.rows[0]));
      }

      // Registrar inscrição de notificação push deste aparelho.
      if (req.query.action === 'push-subscribe') {
        const parsed = pushSubSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
        const { endpoint, keys } = parsed.data;
        await pool.query(
          `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
           values ($1,$2,$3,$4)
           on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
          [auth.userId, endpoint, keys.p256dh, keys.auth]
        );
        return res.status(200).json({ ok: true });
      }

      // Atualizar perfil (nome / profissão)
      const parsed = profileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
      }
      const p = parsed.data;
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, value] of Object.entries(p)) {
        if (value === undefined) continue;
        fields.push(`${PROFILE_COLUMNS[key]} = $${i}`);
        values.push(value);
        i++;
      }
      if (!fields.length) return res.status(400).json({ error: 'bad_request', message: 'Nenhum campo para atualizar' });
      values.push(auth.userId);
      const result = await pool.query(
        `update users set ${fields.join(', ')} where id = $${i}
         returning id, email, name, title, reg_number, signature, email_verified_at,
                   role, access_type, access_until, must_change_password`,
        values
      );
      return res.status(200).json(userToMe(result.rows[0]));
    }

    if (req.method === 'DELETE' && req.query.action === 'push-unsubscribe') {
      const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : null;
      if (!endpoint) return res.status(400).json({ error: 'invalid_input' });
      await pool.query('delete from push_subscriptions where endpoint = $1 and user_id = $2', [endpoint, auth.userId]);
      return res.status(204).end();
    }

    // Admin remove uma conta de cliente (cancelamento/engano na criação).
    if (req.method === 'DELETE' && req.query.action === 'admin-delete') {
      await requireAdmin(pool, auth.userId);
      const userId = typeof req.query.userId === 'string' ? req.query.userId : null;
      if (!userId) return res.status(400).json({ error: 'invalid_input' });
      await pool.query(`delete from users where id = $1 and role <> 'admin'`, [userId]);
      return res.status(204).end();
    }

    if (req.method === 'DELETE') {
      // Exige a senha de novo (como na troca de senha) pra um token sozinho
      // (ex. roubado de um aparelho destravado) não bastar pra apagar a conta.
      const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
      const result = await pool.query('select password_hash from users where id = $1', [auth.userId]);
      if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
      const ok = await bcrypt.compare(parsed.data.password, result.rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: 'wrong_password' });
      // on delete cascade nas FKs já cuida de places/patients/appts/records/etc.
      await pool.query('delete from users where id = $1', [auth.userId]);
      return res.status(204).end();
    }

    res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    if (err instanceof UnauthorizedError) return res.status(401).json({ error: 'unauthorized' });
    throw err;
  }
}
