import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError, NotFoundError } from '../../lib/handler';
import { patientToJson } from '../../lib/mappers';

const patientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  pay: z.enum(['particular', 'convenio']).default('particular'),
  insurerId: z.string().uuid().nullable().optional(),
  birth: z.string().nullable().optional(),
  sex: z.string().nullable().optional(),
  mother: z.string().nullable().optional(),
  father: z.string().nullable().optional(),
  card: z.string().nullable().optional(),
  diag: z.string().nullable().optional(),
});

const patientUpdateSchema = patientSchema.partial();

const columnByKey: Record<string, string> = { insurerId: 'insurer_id' };

function idFromQuery(req: VercelRequest): string | undefined {
  const raw = req.query.id;
  return Array.isArray(raw) ? raw[0] : raw;
}

async function assertInsurerOwned(pool: ReturnType<typeof getPool>, insurerId: string, userId: string) {
  const owned = await pool.query('select id from insurers where id = $1 and user_id = $2', [insurerId, userId]);
  if (!owned.rowCount) throw new BadRequestError('insurerId não pertence a essa usuária');
}

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const pool = getPool();
  const id = idFromQuery(req);

  if (!id) {
    if (req.method === 'GET') {
      const result = await pool.query('select * from patients where user_id = $1 order by name asc', [auth.userId]);
      return res.status(200).json(result.rows.map(patientToJson));
    }
    if (req.method === 'POST') {
      const parsed = patientSchema.safeParse(req.body);
      if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
      const p = parsed.data;
      if (p.insurerId) await assertInsurerOwned(pool, p.insurerId, auth.userId);

      const result = await pool.query(
        `insert into patients (user_id, name, phone, notes, pay, insurer_id, birth, sex, mother, father, card, diag)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [auth.userId, p.name, p.phone, p.notes, p.pay, p.insurerId ?? null, p.birth ?? null, p.sex ?? null, p.mother ?? null, p.father ?? null, p.card ?? null, p.diag ?? null]
      );
      return res.status(201).json(patientToJson(result.rows[0]));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (req.method === 'GET') {
    const result = await pool.query('select * from patients where id = $1 and user_id = $2', [id, auth.userId]);
    if (!result.rowCount) throw new NotFoundError();
    return res.status(200).json(patientToJson(result.rows[0]));
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const parsed = patientUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const p = parsed.data;
    if (p.insurerId) await assertInsurerOwned(pool, p.insurerId, auth.userId);

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
