import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { getPool } from '../../lib/db';

// Quantas cópias diárias ficam guardadas (o Hobby da Vercel só permite 1x/dia,
// então 14 cobre umas duas semanas sem o banco crescer sem limite).
const KEEP = 14;
const TABLES = ['users', 'places', 'insurers', 'patients', 'records', 'appts', 'exceptions'] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // A Vercel Cron chama com esse header; fora disso, exige o segredo (se configurado)
  // pra não deixar qualquer um disparar um dump do banco só sabendo a URL.
  const isVercelCron = req.headers['x-vercel-cron'] != null;
  if (!isVercelCron && process.env.CRON_SECRET) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const pool = getPool();
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

  res.status(200).json({ ok: true, counts: Object.fromEntries(TABLES.map((t) => [t, data[t].length])) });
}
