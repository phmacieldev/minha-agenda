import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError, NotFoundError } from '../../lib/handler';
import { insurerToJson } from '../../lib/mappers';

const insurerSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative().default(0),
  prices: z.record(z.string(), z.number()).optional().default({}),
});

const insurerUpdateSchema = insurerSchema.partial();

function idFromQuery(req: VercelRequest): string | undefined {
  const raw = req.query.id;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const pool = getPool();
  const id = idFromQuery(req);

  if (!id) {
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
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (req.method === 'GET') {
    const result = await pool.query('select * from insurers where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(insurerToJson(result.rows[0]));
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const parsed = insurerUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const i = parsed.data;

    const fields: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    for (const [key, value] of Object.entries(i)) {
      if (value === undefined) continue;
      fields.push(`${key} = $${n}`);
      values.push(key === 'prices' ? JSON.stringify(value) : value);
      n++;
    }
    if (!fields.length) throw new BadRequestError('Nenhum campo para atualizar');

    values.push(id, auth.userId);
    const result = await pool.query(
      `update insurers set ${fields.join(', ')} where id = $${n} and user_id = $${n + 1} returning *`,
      values
    );
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(insurerToJson(result.rows[0]));
  }

  if (req.method === 'DELETE') {
    const result = await pool.query('delete from insurers where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(204).end();
  }

  res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
  res.status(405).json({ error: 'method_not_allowed' });
});
