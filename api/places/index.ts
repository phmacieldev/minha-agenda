import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError } from '../../lib/handler';
import { placeToJson } from '../../lib/mappers';

const hoursSchema = z.record(z.string(), z.array(z.object({ s: z.string(), e: z.string() })));

const placeSchema = z.object({
  name: z.string().min(1),
  color: z.string().default('p1'),
  kind: z.enum(['clinica', 'particular']).default('clinica'),
  address: z.string().optional().default(''),
  price: z.number().nonnegative().default(0),
  duration: z.number().int().positive().default(50),
  hours: hoursSchema.optional().default({}),
  info: z.string().optional().default(''),
  msg: z.string().nullable().optional(),
});

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const pool = getPool();

  if (req.method === 'GET') {
    const result = await pool.query(
      'select * from places where user_id = $1 order by created_at asc',
      [auth.userId]
    );
    return res.status(200).json(result.rows.map(placeToJson));
  }

  if (req.method === 'POST') {
    const parsed = placeSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const p = parsed.data;
    const result = await pool.query(
      `insert into places (user_id, name, color, kind, address, price, duration, hours, info, msg)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [auth.userId, p.name, p.color, p.kind, p.address, p.price, p.duration, JSON.stringify(p.hours), p.info, p.msg ?? null]
    );
    return res.status(201).json(placeToJson(result.rows[0]));
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'method_not_allowed' });
});
