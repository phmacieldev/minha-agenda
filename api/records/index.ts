import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError, NotFoundError } from '../../lib/handler';
import { recordToJson } from '../../lib/mappers';

const recordSchema = z.object({
  id: z.string().uuid().optional(),
  patientId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date deve ser YYYY-MM-DD'),
  placeId: z.string().uuid().nullable().optional(),
  apptId: z.string().uuid().nullable().optional(),
  text: z.string(),
});

const recordUpdateSchema = recordSchema.omit({ id: true, patientId: true }).partial();

function idFromQuery(req: VercelRequest): string | undefined {
  const raw = req.query.id;
  return Array.isArray(raw) ? raw[0] : raw;
}

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const pool = getPool();
  const id = idFromQuery(req);

  if (!id) {
    if (req.method === 'GET') {
      const { patientId } = req.query;
      const conditions = ['user_id = $1'];
      const values: unknown[] = [auth.userId];
      if (typeof patientId === 'string') { conditions.push('patient_id = $2'); values.push(patientId); }
      const result = await pool.query(
        `select * from records where ${conditions.join(' and ')} order by date desc`,
        values
      );
      return res.status(200).json(result.rows.map(recordToJson));
    }
    if (req.method === 'POST') {
      const parsed = recordSchema.safeParse(req.body);
      if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
      const r = parsed.data;

      const ownedPatient = await pool.query('select id from patients where id = $1 and user_id = $2', [r.patientId, auth.userId]);
      if (!ownedPatient.rowCount) throw new BadRequestError('patientId não pertence a essa usuária');
      if (r.placeId) {
        const owned = await pool.query('select id from places where id = $1 and user_id = $2', [r.placeId, auth.userId]);
        if (!owned.rowCount) throw new BadRequestError('placeId não pertence a essa usuária');
      }

      const id2 = r.id ?? randomUUID();
      const result = await pool.query(
        `insert into records (id, user_id, patient_id, date, place_id, appt_id, text)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (id) do update set
           date = excluded.date, place_id = excluded.place_id, appt_id = excluded.appt_id, text = excluded.text
         where records.user_id = excluded.user_id
         returning *`,
        [id2, auth.userId, r.patientId, r.date, r.placeId ?? null, r.apptId ?? null, r.text]
      );
      return res.status(201).json(recordToJson(result.rows[0]));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (req.method === 'GET') {
    const result = await pool.query('select * from records where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(recordToJson(result.rows[0]));
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const parsed = recordUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const r = parsed.data;

    if (r.placeId) {
      const owned = await pool.query('select id from places where id = $1 and user_id = $2', [r.placeId, auth.userId]);
      if (!owned.rowCount) throw new BadRequestError('placeId não pertence a essa usuária');
    }

    const columnByKey: Record<string, string> = { placeId: 'place_id', apptId: 'appt_id' };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(r)) {
      if (value === undefined) continue;
      fields.push(`${columnByKey[key] ?? key} = $${i}`);
      values.push(value);
      i++;
    }
    if (!fields.length) throw new BadRequestError('Nenhum campo para atualizar');

    values.push(id, auth.userId);
    const result = await pool.query(
      `update records set ${fields.join(', ')} where id = $${i} and user_id = $${i + 1} returning *`,
      values
    );
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(recordToJson(result.rows[0]));
  }

  if (req.method === 'DELETE') {
    const result = await pool.query('delete from records where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(204).end();
  }

  res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
  res.status(405).json({ error: 'method_not_allowed' });
});
