import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError } from '../../lib/handler';
import { exceptionToJson } from '../../lib/mappers';

const exceptionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date deve ser YYYY-MM-DD'),
  placeId: z.string().uuid().nullable().optional(),
  type: z.enum(['block', 'extra']),
  allDay: z.boolean().default(false),
  s: z.string().nullable().optional(),
  e: z.string().nullable().optional(),
  note: z.string().optional().default(''),
});

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const pool = getPool();

  if (req.method === 'GET') {
    const { from, to } = req.query;
    const conditions = ['user_id = $1'];
    const values: unknown[] = [auth.userId];
    let i = 2;
    if (typeof from === 'string') { conditions.push(`date >= $${i++}`); values.push(from); }
    if (typeof to === 'string') { conditions.push(`date <= $${i++}`); values.push(to); }

    const result = await pool.query(
      `select * from exceptions where ${conditions.join(' and ')} order by date asc`,
      values
    );
    return res.status(200).json(result.rows.map(exceptionToJson));
  }

  if (req.method === 'POST') {
    const parsed = exceptionSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const x = parsed.data;

    if (x.placeId) {
      const owned = await pool.query('select id from places where id = $1 and user_id = $2', [x.placeId, auth.userId]);
      if (!owned.rowCount) throw new BadRequestError('placeId não pertence a essa usuária');
    }

    const result = await pool.query(
      `insert into exceptions (user_id, date, place_id, type, all_day, s, e, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [auth.userId, x.date, x.placeId ?? null, x.type, x.allDay, x.s ?? null, x.e ?? null, x.note]
    );
    return res.status(201).json(exceptionToJson(result.rows[0]));
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'method_not_allowed' });
});
