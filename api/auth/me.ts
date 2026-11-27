import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getAuth, UnauthorizedError, DEFAULT_PASSWORD } from '../../lib/auth';
import { getPool } from '../../lib/db';
import { userToMe, adminUserToJson } from '../../lib/mappers';
import { loadResources } from '../../lib/bootstrap';
import { sendJson } from '../../lib/respond';
import { logEvent } from '../../lib/adminLog';
import { withErrorLog } from '../../lib/withErrorLog';

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
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  accessType: z.enum(['monthly', 'annual', 'unlimited']),
  accessUntil: z.string().datetime().optional(),
});

async function requireAdmin(pool: ReturnType<typeof getPool>, userId: string) {
  const r = await pool.query('select role from users where id = $1', [userId]);
  if (r.rows[0]?.role !== 'admin') throw new UnauthorizedError('forbidden');
}

async function handler(req: VercelRequest, res: VercelResponse) {
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

    // Painel admin: logs de eventos + métricas gerais + atividade por conta.
    // As métricas extras (vencendo em breve, ativação, uso no mês, rotina
    // diária) servem pra mostrar valor do app pra ela mesma e, no futuro,
    // pra clientes em potencial (print do painel como prova de uso real).
    if (req.method === 'GET' && req.query.action === 'admin-logs') {
      await requireAdmin(pool, auth.userId);
      // Log de eventos paginado (sem feedback, que tem a própria aba e lista
      // à parte) — evita rolagem infinita numa lista que só cresce.
      const logsLimit = Math.min(Math.max(parseInt(String(req.query.logsLimit ?? '20'), 10) || 20, 1), 100);
      const logsOffset = Math.max(parseInt(String(req.query.logsOffset ?? '0'), 10) || 0, 0);
      const [logs, logsCount, feedbacks, notifications, metrics, clients, expiringSoon, cronBackup, cronDigest, growth] = await Promise.all([
        pool.query(
          `select level, event, email, message, created_at from admin_logs where event <> 'feedback' order by created_at desc limit $1 offset $2`,
          [logsLimit, logsOffset]
        ),
        pool.query(`select count(*)::int as n from admin_logs where event <> 'feedback'`),
        pool.query(`select email, message, created_at from admin_logs where event = 'feedback' order by created_at desc limit 200`),
        // Pro sino/popup de notificação: últimos eventos relevantes (feedback
        // ou nível acima de info), independente da paginação do log geral.
        pool.query(
          `select level, event, email, message, created_at from admin_logs where event = 'feedback' or level <> 'info' order by created_at desc limit 30`
        ),
        pool.query(`select
            (select count(*)::int from users where role <> 'admin') as total_clients,
            (select count(*)::int from users where role <> 'admin' and last_seen_at > now() - interval '5 minutes') as online_now,
            (select count(*)::int from users where role <> 'admin' and last_seen_at > now() - interval '7 days') as active_7d,
            (select count(*)::int from users where role <> 'admin' and must_change_password) as awaiting_activation,
            (select count(*)::int from appts) as total_appts,
            (select count(*)::int from appts where date >= date_trunc('month', now())::date) as appts_month,
            (select count(*)::int from records where date >= date_trunc('month', now())::date) as records_month,
            (select count(*)::int from patients) as total_patients`),
        pool.query(`select id, email, name, title, last_seen_at from users where role <> 'admin' order by last_seen_at desc nulls last limit 50`),
        pool.query(`select id, email, name, access_until from users
           where role <> 'admin' and access_type <> 'unlimited' and access_until between now() and now() + interval '7 days'
           order by access_until asc`),
        pool.query(`select event, created_at from admin_logs where event in ('cron_backup_ok','cron_backup_failed') order by created_at desc limit 1`),
        pool.query(`select event, created_at from admin_logs where event in ('cron_digest_ok','cron_digest_failed') order by created_at desc limit 1`),
        // Crescimento de contas por mês (últimos 6 meses) — gráfico simples
        // no painel Geral, serve de prova de uso real pro portfólio.
        pool.query(`select to_char(date_trunc('month', m), 'YYYY-MM') as month,
            (select count(*)::int from users where role <> 'admin' and date_trunc('month', created_at) = date_trunc('month', m)) as n
           from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') as m
           order by month asc`),
      ]);
      return res.status(200).json({
        logs: logs.rows.map((r) => ({ level: r.level, event: r.event, email: r.email, message: r.message, createdAt: r.created_at })),
        logsTotal: logsCount.rows[0].n,
        logsOffset,
        logsLimit,
        feedbacks: feedbacks.rows.map((r) => ({ email: r.email, message: r.message, createdAt: r.created_at })),
        notifications: notifications.rows.map((r) => ({ level: r.level, event: r.event, email: r.email, message: r.message, createdAt: r.created_at })),
        metrics: {
          totalClients: metrics.rows[0].total_clients,
          onlineNow: metrics.rows[0].online_now,
          active7d: metrics.rows[0].active_7d,
          awaitingActivation: metrics.rows[0].awaiting_activation,
          totalAppts: metrics.rows[0].total_appts,
          apptsMonth: metrics.rows[0].appts_month,
          recordsMonth: metrics.rows[0].records_month,
          totalPatients: metrics.rows[0].total_patients,
        },
        clients: clients.rows.map((r) => ({ id: r.id, email: r.email, name: r.name, title: r.title, lastSeenAt: r.last_seen_at })),
        expiringSoon: expiringSoon.rows.map((r) => ({ id: r.id, email: r.email, name: r.name, accessUntil: r.access_until })),
        cron: {
          backup: cronBackup.rows[0] ? { ok: cronBackup.rows[0].event === 'cron_backup_ok', at: cronBackup.rows[0].created_at } : null,
          digest: cronDigest.rows[0] ? { ok: cronDigest.rows[0].event === 'cron_digest_ok', at: cronDigest.rows[0].created_at } : null,
        },
        growth: growth.rows.map((r) => ({ month: r.month, count: r.n })),
      });
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
      pool.query('update users set last_seen_at = now() where id = $1', [auth.userId]).catch(() => {});

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

      // Admin ajusta nome/e-mail e o prazo/tipo de acesso de uma conta de cliente.
      if (req.query.action === 'admin-update') {
        await requireAdmin(pool, auth.userId);
        const parsed = adminCreateUpdateSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
        const { userId, name, email, accessType, accessUntil } = parsed.data;
        if (accessType !== 'unlimited' && !accessUntil) {
          return res.status(400).json({ error: 'invalid_input', message: 'accessUntil é obrigatório para esse tipo de acesso' });
        }
        const normalizedEmail = email ? email.toLowerCase() : undefined;
        if (normalizedEmail) {
          const existing = await pool.query('select id from users where email = $1 and id <> $2', [normalizedEmail, userId]);
          if (existing.rowCount) return res.status(409).json({ error: 'email_in_use' });
        }
        const result = await pool.query(
          `update users set access_type = $1, access_until = $2, name = coalesce($3, name), email = coalesce($4, email)
           where id = $5 and role <> 'admin' returning *`,
          [accessType, accessType === 'unlimited' ? null : accessUntil, name ?? null, normalizedEmail ?? null, userId]
        );
        if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
        return res.status(200).json(adminUserToJson(result.rows[0]));
      }

      // Admin reseta a senha de uma cliente travada de volta pra padrão —
      // cobre o esquecimento de senha sem precisar mexer direto no banco
      // (o envio de e-mail de recuperação depende de RESEND_API_KEY, que
      // nem sempre está configurado).
      if (req.query.action === 'admin-reset-password') {
        await requireAdmin(pool, auth.userId);
        const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
        if (!userId) return res.status(400).json({ error: 'invalid_input' });
        const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
        const result = await pool.query(
          `update users set password_hash = $1, must_change_password = true
           where id = $2 and role <> 'admin' returning *`,
          [passwordHash, userId]
        );
        if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
        logEvent(pool, { level: 'warn', event: 'password_reset_by_admin', userId: result.rows[0].id, email: result.rows[0].email });
        return res.status(200).json(adminUserToJson(result.rows[0]));
      }

      // Feedback enviado pela cliente (ou pela própria admin) dentro do app —
      // fica registrado em admin_logs pra aparecer no painel da admin, além
      // do envio por e-mail que o front já faz em paralelo.
      if (req.query.action === 'feedback') {
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        if (!message) return res.status(400).json({ error: 'invalid_input' });
        await logEvent(pool, { event: 'feedback', userId: auth.userId, email: auth.email, message });
        return res.status(200).json({ ok: true });
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

export default withErrorLog(handler);
