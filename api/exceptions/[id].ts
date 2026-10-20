import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError, NotFoundError } from '../../lib/handler';
import { exceptionToJson } from '../../lib/mappers';

const exceptionUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  placeId: z.string().uuid().nullable().optional(),
  type: z.enum(['block', 'extra']).optional(),
  allDay: z.boolean().optional(),
  s: z.string().nullable().optional(),
  e: z.string().nullable().optional(),
  note: z.string().optional(),
});

const columnByKey: Record<string, string> = { placeId: 'place_id', allDay: 'all_day' };

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const id = req.query.id as string;
  const pool = getPool();

  if (req.method === 'GET') {
    const result = await pool.query('select * from exceptions where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(exceptionToJson(result.rows[0]));
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const parsed = exceptionUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const x = parsed.data;

    if (x.placeId) {
      const owned = await pool.query('select id from places where id = $1 and user_id = $2', [x.placeId, auth.userId]);
      if (!owned.rowCount) throw new BadRequestError('placeId não pertence a essa usuária');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(x)) {
      if (value === undefined) continue;
      fields.push(`${columnByKey[key] ?? key} = $${i}`);
      values.push(value);
      i++;
    }
    if (!fields.length) throw new BadRequestError('Nenhum campo para atualizar');

    values.push(id, auth.userId);
    const result = await pool.query(
      `update exceptions set ${fields.join(', ')} where id = $${i} and user_id = $${i + 1} returning *`,
      values
    );
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(exceptionToJson(result.rows[0]));
  }

  if (req.method === 'DELETE') {
    const result = await pool.query('delete from exceptions where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(204).end();
  }

  res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
  res.status(405).json({ error: 'method_not_allowed' });
});
