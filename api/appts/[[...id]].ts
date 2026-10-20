import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError, NotFoundError } from '../../lib/handler';
import { apptToJson } from '../../lib/mappers';

const apptSchema = z.object({
  patientId: z.string().uuid(),
  placeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date deve ser YYYY-MM-DD'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time deve ser HH:MM'),
  dur: z.number().int().positive().default(50),
  price: z.number().nonnegative().default(0),
  pay: z.enum(['particular', 'convenio']).default('particular'),
  insurerId: z.string().uuid().nullable().optional(),
  insName: z.string().nullable().optional(),
  status: z.enum(['agendado', 'confirmado', 'concluido', 'faltou', 'cancelado']).default('agendado'),
  paid: z.boolean().default(false),
  notes: z.string().optional().default(''),
});

const apptUpdateSchema = apptSchema.partial();

const columnByKey: Record<string, string> = {
  patientId: 'patient_id',
  placeId: 'place_id',
  insurerId: 'insurer_id',
  insName: 'ins_name',
};

function idFromQuery(req: VercelRequest): string | undefined {
  const raw = req.query.id;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

async function assertOwned(pool: ReturnType<typeof getPool>, table: string, id: string, userId: string, label: string) {
  const owned = await pool.query(`select id from ${table} where id = $1 and user_id = $2`, [id, userId]);
  if (!owned.rowCount) throw new BadRequestError(`${label} não pertence a essa usuária`);
}

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const pool = getPool();
  const id = idFromQuery(req);

  if (!id) {
    if (req.method === 'GET') {
      const { from, to, placeId } = req.query;
      const conditions = ['user_id = $1'];
      const values: unknown[] = [auth.userId];
      let i = 2;
      if (typeof from === 'string') { conditions.push(`date >= $${i++}`); values.push(from); }
      if (typeof to === 'string') { conditions.push(`date <= $${i++}`); values.push(to); }
      if (typeof placeId === 'string') { conditions.push(`place_id = $${i++}`); values.push(placeId); }

      const result = await pool.query(
        `select * from appts where ${conditions.join(' and ')} order by date asc, time asc`,
        values
      );
      return res.status(200).json(result.rows.map(apptToJson));
    }
    if (req.method === 'POST') {
      const parsed = apptSchema.safeParse(req.body);
      if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
      const a = parsed.data;

      await assertOwned(pool, 'patients', a.patientId, auth.userId, 'patientId');
      await assertOwned(pool, 'places', a.placeId, auth.userId, 'placeId');
      if (a.insurerId) await assertOwned(pool, 'insurers', a.insurerId, auth.userId, 'insurerId');

      const result = await pool.query(
        `insert into appts (user_id, patient_id, place_id, date, time, dur, price, pay, insurer_id, ins_name, status, paid, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
        [auth.userId, a.patientId, a.placeId, a.date, a.time, a.dur, a.price, a.pay, a.insurerId ?? null, a.insName ?? null, a.status, a.paid, a.notes]
      );
      return res.status(201).json(apptToJson(result.rows[0]));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (req.method === 'GET') {
    const result = await pool.query('select * from appts where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(apptToJson(result.rows[0]));
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const parsed = apptUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const a = parsed.data;

    if (a.patientId) await assertOwned(pool, 'patients', a.patientId, auth.userId, 'patientId');
    if (a.placeId) await assertOwned(pool, 'places', a.placeId, auth.userId, 'placeId');
    if (a.insurerId) await assertOwned(pool, 'insurers', a.insurerId, auth.userId, 'insurerId');

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
