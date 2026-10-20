import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError, NotFoundError } from '../../lib/handler';
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

const placeUpdateSchema = placeSchema.partial();

function idFromQuery(req: VercelRequest): string | undefined {
  const raw = req.query.id;
  return Array.isArray(raw) ? raw[0] : raw;
}

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const pool = getPool();
  const id = idFromQuery(req);

  if (!id) {
    if (req.method === 'GET') {
      const result = await pool.query('select * from places where user_id = $1 order by created_at asc', [auth.userId]);
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
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (req.method === 'GET') {
    const result = await pool.query('select * from places where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(placeToJson(result.rows[0]));
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const parsed = placeUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const p = parsed.data;

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(p)) {
      if (value === undefined) continue;
      fields.push(`${key} = $${i}`);
      values.push(key === 'hours' ? JSON.stringify(value) : value);
      i++;
    }
    if (!fields.length) throw new BadRequestError('Nenhum campo para atualizar');

    values.push(id, auth.userId);
    const result = await pool.query(
      `update places set ${fields.join(', ')} where id = $${i} and user_id = $${i + 1} returning *`,
      values
    );
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(placeToJson(result.rows[0]));
  }

  if (req.method === 'DELETE') {
    const result = await pool.query('delete from places where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(204).end();
  }

  res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
  res.status(405).json({ error: 'method_not_allowed' });
});
