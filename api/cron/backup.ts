import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { getPool } from '../../lib/db';
import { sendPush } from '../../lib/push';
import { logEvent } from '../../lib/adminLog';
import { getAuth, UnauthorizedError } from '../../lib/auth';

async function requireAdmin(pool: ReturnType<typeof getPool>, req: VercelRequest): Promise<string> {
  const auth = getAuth(req);
  const r = await pool.query('select role from users where id = $1', [auth.userId]);
  if (r.rows[0]?.role !== 'admin') throw new UnauthorizedError('forbidden');
  return auth.userId;
}

// Quantas cópias semanais ficam guardadas — toda sexta às 22h (01h UTC de
// sábado, ver vercel.json). 8 cobre cerca de 2 meses de histórico sem o
// banco crescer sem limite; a cada novo backup, o mais antigo além desse
// número é apagado.
const KEEP = 8;
const TABLES = ['users', 'places', 'insurers', 'patients', 'records', 'appts', 'exceptions'] as const;

async function runBackup(pool: ReturnType<typeof getPool>) {
  const data: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const result = await pool.query(`select * from ${table}`);
    data[table] = result.rows;
  }
  await pool.query('insert into backups (id, data) values ($1, $2)', [randomUUID(), JSON.stringify(data)]);
  await pool.query(
    `delete from backups where id not in (select id from backups order by created_at desc limit $1)`,
    [KEEP]
  );
  return { ok: true, counts: Object.fromEntries(TABLES.map((t) => [t, data[t].length])) };
}

// Resumo diário por push — um aviso de bom dia com quantos atendimentos a
// profissional tem hoje. Não manda nada em dia sem nenhum atendimento, pra
// não virar ruído. "Hoje" calculado em UTC-3 fixo (Brasil não tem mais
// horário de verão), não pela hora UTC do servidor.
async function runDigest(pool: ReturnType<typeof getPool>) {
  const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const subs = await pool.query('select id, user_id, endpoint, p256dh, auth from push_subscriptions');
  const byUser = new Map<string, typeof subs.rows>();
  for (const row of subs.rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id)!.push(row);
  }
  let usersNotified = 0;
  let pushesSent = 0;
  for (const [userId, subscriptions] of byUser) {
    const countResult = await pool.query(
      `select count(*)::int as n from appts where user_id = $1 and date = $2 and status <> 'cancelado'`,
      [userId, today]
    );
    const n = countResult.rows[0].n;
    if (!n) continue;
    const body = n === 1 ? 'Você tem 1 atendimento hoje.' : `Você tem ${n} atendimentos hoje.`;
    let anySent = false;
    for (const sub of subscriptions) {
      if (await sendPush(pool, sub, { title: 'MyDay', body, url: '/' })) {
        pushesSent++;
        anySent = true;
      }
    }
    if (anySent) usersNotified++;
  }
  return { ok: true, usersNotified, pushesSent };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const pool = getPool();

  // Painel admin: lista os backups guardados (pra escolher qual baixar) ou
  // baixa um deles como arquivo .json. Reaproveita este arquivo em vez de
  // criar rotas novas — o plano Hobby da Vercel já está no limite de 12.
  if (req.method === 'GET' && (req.query.action === 'list' || req.query.action === 'download')) {
    try {
      await requireAdmin(pool, req);
    } catch (err) {
      if (err instanceof UnauthorizedError) return res.status(401).json({ error: 'unauthorized' });
      throw err;
    }
    if (req.query.action === 'list') {
      const result = await pool.query(
        `select id, created_at, pg_column_size(data) as size_bytes from backups order by created_at desc limit 20`
      );
      return res.status(200).json(result.rows.map((r) => ({ id: r.id, createdAt: r.created_at, sizeBytes: r.size_bytes })));
    }
    const id = typeof req.query.id === 'string' ? req.query.id : null;
    if (!id) return res.status(400).json({ error: 'invalid_input' });
    const result = await pool.query('select data, created_at from backups where id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
    const filename = `myday-backup-${new Date(result.rows[0].created_at).toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(JSON.stringify(result.rows[0].data));
  }

  // A Vercel Cron chama com esse header; fora disso, aceita o segredo (se
  // configurado) ou uma conta admin logada (botão de "rodar agora" no
  // painel) — pra não deixar qualquer um disparar um dump do banco (ou um
  // spam de push) só sabendo a URL.
  const isVercelCron = req.headers['x-vercel-cron'] != null;
  if (!isVercelCron && process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`) {
    // segredo de cron bate — segue
  } else if (!isVercelCron) {
    try {
      await requireAdmin(pool, req);
    } catch (err) {
      if (err instanceof UnauthorizedError) return res.status(401).json({ error: 'unauthorized' });
      throw err;
    }
  }

  // Sem isso, um erro de conexão (banco fora do ar, rede instável) sobe como
  // promise rejeitada sem handler — localmente isso já derrubou o processo
  // inteiro do `vercel dev` (não só essa invocação). Em produção o runtime da
  // Vercel é isolado por invocação, mas mesmo assim vale responder 500 e
  // logar, em vez de deixar vazar uma rejeição não tratada.
  try {
    // Reaproveita este arquivo pros dois cron jobs em vez de criar uma rota
    // nova — o plano Hobby da Vercel já está no limite de 12 functions.
    const job = req.query.job === 'digest' ? 'digest' : 'backup';
    const result = job === 'digest' ? await runDigest(pool) : await runBackup(pool);
    logEvent(pool, { event: `cron_${job}_ok`, message: JSON.stringify(result) });
    res.status(200).json(result);
  } catch (err) {
    const job = req.query.job === 'digest' ? 'digest' : 'backup';
    console.error('[cron/backup] falhou', job, err);
    logEvent(getPool(), { level: 'error', event: `cron_${job}_failed`, message: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'cron_failed' });
  }
}
