import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError, NotFoundError } from '../../lib/handler';
import { placeToJson } from '../../lib/mappers';

const hoursSchema = z.record(z.string(), z.array(z.object({ s: z.string(), e: z.string() })));

const placeUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  kind: z.enum(['clinica', 'particular']).optional(),
  address: z.string().optional(),
  price: z.number().nonnegative().optional(),
  duration: z.number().int().positive().optional(),
  hours: hoursSchema.optional(),
  info: z.string().optional(),
  msg: z.string().nullable().optional(),
});

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const id = req.query.id as string;
  const pool = getPool();

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
    const columnByKey: Record<string, string> = { hours: 'hours' };
    for (const [key, value] of Object.entries(p)) {
      if (value === undefined) continue;
      const column = columnByKey[key] ?? key;
      fields.push(`${column} = $${i}`);
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
