import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError, NotFoundError } from '../../lib/handler';
import { apptToJson } from '../../lib/mappers';

const apptUpdateSchema = z.object({
  patientId: z.string().uuid().optional(),
  placeId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dur: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
  pay: z.enum(['particular', 'convenio']).optional(),
  insurerId: z.string().uuid().nullable().optional(),
  insName: z.string().nullable().optional(),
  status: z.enum(['agendado', 'confirmado', 'concluido', 'faltou', 'cancelado']).optional(),
  paid: z.boolean().optional(),
  notes: z.string().optional(),
});

const columnByKey: Record<string, string> = {
  patientId: 'patient_id',
  placeId: 'place_id',
  insurerId: 'insurer_id',
  insName: 'ins_name',
};

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const id = req.query.id as string;
  const pool = getPool();

  if (req.method === 'GET') {
    const result = await pool.query('select * from appts where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(apptToJson(result.rows[0]));
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const parsed = apptUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const a = parsed.data;

    if (a.patientId) {
      const owned = await pool.query('select id from patients where id = $1 and user_id = $2', [a.patientId, auth.userId]);
      if (!owned.rowCount) throw new BadRequestError('patientId não pertence a essa usuária');
    }
    if (a.placeId) {
      const owned = await pool.query('select id from places where id = $1 and user_id = $2', [a.placeId, auth.userId]);
      if (!owned.rowCount) throw new BadRequestError('placeId não pertence a essa usuária');
    }
    if (a.insurerId) {
      const owned = await pool.query('select id from insurers where id = $1 and user_id = $2', [a.insurerId, auth.userId]);
      if (!owned.rowCount) throw new BadRequestError('insurerId não pertence a essa usuária');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(a)) {
      if (value === undefined) continue;
      fields.push(`${columnByKey[key] ?? key} = $${i}`);
      values.push(value);
      i++;
    }
    if (!fields.length) throw new BadRequestError('Nenhum campo para atualizar');

    values.push(id, auth.userId);
    const result = await pool.query(
      `update appts set ${fields.join(', ')} where id = $${i} and user_id = $${i + 1} returning *`,
      values
    );
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(apptToJson(result.rows[0]));
  }

  if (req.method === 'DELETE') {
    const result = await pool.query('delete from appts where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(204).end();
  }

  res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
  res.status(405).json({ error: 'method_not_allowed' });
});
