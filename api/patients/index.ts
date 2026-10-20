import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { withAuth, BadRequestError } from '../../lib/handler';
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

export default withAuth(async (req: VercelRequest, res: VercelResponse, auth) => {
  const pool = getPool();

  if (req.method === 'GET') {
    const result = await pool.query(
      'select * from patients where user_id = $1 order by name asc',
      [auth.userId]
    );
    return res.status(200).json(result.rows.map(patientToJson));
  }

  if (req.method === 'POST') {
    const parsed = patientSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError(JSON.stringify(parsed.error.flatten()));
    const p = parsed.data;

    if (p.insurerId) {
      const owned = await pool.query('select id from insurers where id = $1 and user_id = $2', [p.insurerId, auth.userId]);
      if (!owned.rowCount) throw new BadRequestError('insurerId não pertence a essa usuária');
    }

    const result = await pool.query(
      `insert into patients (user_id, name, phone, notes, pay, insurer_id, birth, sex, mother, father, card, diag)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [auth.userId, p.name, p.phone, p.notes, p.pay, p.insurerId ?? null, p.birth ?? null, p.sex ?? null, p.mother ?? null, p.father ?? null, p.card ?? null, p.diag ?? null]
    );
    return res.status(201).json(patientToJson(result.rows[0]));
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'method_not_allowed' });
});
