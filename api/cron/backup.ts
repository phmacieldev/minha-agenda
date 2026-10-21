import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { getPool } from '../../lib/db';
import { sendPush } from '../../lib/push';

// Quantas cópias diárias ficam guardadas (o Hobby da Vercel só permite 1x/dia,
// então 14 cobre umas duas semanas sem o banco crescer sem limite).
const KEEP = 14;
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
      if (await sendPush(pool, sub, { title: 'Minha Agenda', body, url: '/' })) {
        pushesSent++;
        anySent = true;
      }
    }
    if (anySent) usersNotified++;
  }
  return { ok: true, usersNotified, pushesSent };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // A Vercel Cron chama com esse header; fora disso, exige o segredo (se configurado)
  // pra não deixar qualquer um disparar um dump do banco (ou um spam de push)
  // só sabendo a URL.
  const isVercelCron = req.headers['x-vercel-cron'] != null;
  if (!isVercelCron && process.env.CRON_SECRET) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  // Sem isso, um erro de conexão (banco fora do ar, rede instável) sobe como
  // promise rejeitada sem handler — localmente isso já derrubou o processo
  // inteiro do `vercel dev` (não só essa invocação). Em produção o runtime da
  // Vercel é isolado por invocação, mas mesmo assim vale responder 500 e
  // logar, em vez de deixar vazar uma rejeição não tratada.
  try {
    const pool = getPool();
    // Reaproveita este arquivo pros dois cron jobs em vez de criar uma rota
    // nova — o plano Hobby da Vercel já está no limite de 12 functions.
    const result = req.query.job === 'digest' ? await runDigest(pool) : await runBackup(pool);
    res.status(200).json(result);
  } catch (err) {
    console.error('[cron/backup] falhou', req.query.job === 'digest' ? 'digest' : 'backup', err);
    res.status(500).json({ error: 'cron_failed' });
  }
}
