import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError } from '../../lib/handler';
import { insurerToJson } from '../../lib/mappers';

const insurerSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative().default(0),
  prices: z.record(z.string(), z.number()).optional().default({}),
});

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const pool = getPool();

  if (req.method === 'GET') {
    const result = await pool.query('select * from insurers where user_id = $1 order by name asc', [auth.userId]);
    return res.status(200).json(result.rows.map(insurerToJson));
  }

  if (req.method === 'POST') {
    const parsed = insurerSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const i = parsed.data;
    const result = await pool.query(
      'insert into insurers (user_id, name, price, prices) values ($1,$2,$3,$4) returning *',
      [auth.userId, i.name, i.price, JSON.stringify(i.prices)]
    );
    return res.status(201).json(insurerToJson(result.rows[0]));
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'method_not_allowed' });
});
