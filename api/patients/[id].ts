import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError, NotFoundError } from '../../lib/handler';
import { patientToJson } from '../../lib/mappers';

const patientUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  pay: z.enum(['particular', 'convenio']).optional(),
  insurerId: z.string().uuid().nullable().optional(),
  birth: z.string().nullable().optional(),
  sex: z.string().nullable().optional(),
  mother: z.string().nullable().optional(),
  father: z.string().nullable().optional(),
  card: z.string().nullable().optional(),
  diag: z.string().nullable().optional(),
});

const columnByKey: Record<string, string> = { insurerId: 'insurer_id' };

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const id = req.query.id as string;
  const pool = getPool();

  if (req.method === 'GET') {
    const result = await pool.query('select * from patients where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(patientToJson(result.rows[0]));
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const parsed = patientUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const p = parsed.data;

    if (p.insurerId) {
      const owned = await pool.query('select id from insurers where id = $1 and user_id = $2', [p.insurerId, auth.userId]);
      if (!owned.rowCount) throw new BadRequestError('insurerId não pertence a essa usuária');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(p)) {
      if (value === undefined) continue;
      fields.push(`${columnByKey[key] ?? key} = $${i}`);
      values.push(value);
      i++;
    }
    if (!fields.length) throw new BadRequestError('Nenhum campo para atualizar');

    values.push(id, auth.userId);
    const result = await pool.query(
      `update patients set ${fields.join(', ')} where id = $${i} and user_id = $${i + 1} returning *`,
      values
    );
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(patientToJson(result.rows[0]));
  }

  if (req.method === 'DELETE') {
    const result = await pool.query('delete from patients where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(204).end();
  }

  res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
  res.status(405).json({ error: 'method_not_allowed' });
});
