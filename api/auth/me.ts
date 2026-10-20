import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth, UnauthorizedError } from '../../lib/auth';
import { getPool } from '../../lib/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = getAuth(req);
    const pool = getPool();
    const result = await pool.query(
      'select id, email, name, title, email_verified_at from users where id = $1',
      [auth.userId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
    const row = result.rows[0];
    res.status(200).json({
      id: row.id,
      email: row.email,
      name: row.name,
      title: row.title,
      emailVerified: Boolean(row.email_verified_at),
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return res.status(401).json({ error: 'unauthorized' });
    throw err;
  }
}
