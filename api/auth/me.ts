import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getAuth, UnauthorizedError } from '../../lib/auth';
import { getPool } from '../../lib/db';
import { placeToJson, patientToJson, insurerToJson, apptToJson, exceptionToJson, recordToJson } from '../../lib/mappers';

function rowToMe(row: any) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    title: row.title,
    regNumber: row.reg_number,
    signature: row.signature,
    emailVerified: Boolean(row.email_verified_at),
  };
}

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = getAuth(req);
    const pool = getPool();

    if (req.method === 'GET') {
      const result = await pool.query(
        'select id, email, name, title, reg_number, signature, email_verified_at from users where id = $1',
        [auth.userId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
      const me = rowToMe(result.rows[0]);

      // ?full=1: devolve perfil + todos os recursos numa chamada só, em vez de
      // 7 (perfil, places, patients, insurers, appts, exceptions, records).
      // O pullAll() do front usava Promise.all com 7 fetches; cada um é uma
      // invocação de função separada, e isso soma bastante — principalmente
      // no `vercel dev` local, que não paraleliza bem várias invocações ao
      // mesmo tempo (login+sync chegava a 15-20s). Uma função só com 6
      // queries no mesmo pool de conexão resolve isso.
      if (req.query.full !== '1') return res.status(200).json(me);

      const [places, patients, insurers, appts, exceptions, records] = await Promise.all([
        pool.query('select * from places where user_id = $1 order by created_at asc', [auth.userId]),
        pool.query('select * from patients where user_id = $1 order by name asc', [auth.userId]),
        pool.query('select * from insurers where user_id = $1 order by name asc', [auth.userId]),
        pool.query('select * from appts where user_id = $1 order by date asc, time asc', [auth.userId]),
        pool.query('select * from exceptions where user_id = $1 order by date asc', [auth.userId]),
        pool.query('select * from records where user_id = $1 order by date desc', [auth.userId]),
      ]);
      return res.status(200).json({
        me,
        places: places.rows.map(placeToJson),
        patients: patients.rows.map(patientToJson),
        insurers: insurers.rows.map(insurerToJson),
        appts: appts.rows.map(apptToJson),
        exceptions: exceptions.rows.map(exceptionToJson),
        records: records.rows.map(recordToJson),
      });
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
        await pool.query('update users set password_hash = $1 where id = $2', [newHash, auth.userId]);
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
        `update users set ${fields.join(', ')} where id = $${i} returning id, email, name, title, reg_number, signature, email_verified_at`,
        values
      );
      return res.status(200).json(rowToMe(result.rows[0]));
    }

    res.setHeader('Allow', 'GET, PUT, PATCH');
    res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    if (err instanceof UnauthorizedError) return res.status(401).json({ error: 'unauthorized' });
    throw err;
  }
}
