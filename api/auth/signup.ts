import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getAuth, UnauthorizedError, DEFAULT_PASSWORD } from '../../lib/auth';
import { getPool } from '../../lib/db';
import { adminUserToJson } from '../../lib/mappers';
import { logEvent } from '../../lib/adminLog';
import { withErrorLog } from '../../lib/withErrorLog';

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  title: z.string().optional(),
  accessType: z.enum(['monthly', 'annual', 'unlimited']),
  accessUntil: z.string().datetime().optional(),
});

// Não há mais cadastro público: só a conta admin cria contas de clientes
// (ver PLANO de acesso pago). Reaproveita este arquivo em vez de criar uma
// function nova — o plano Hobby da Vercel já está no limite de 12.
async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const auth = getAuth(req);
    const pool = getPool();
    const adminRow = await pool.query('select role from users where id = $1', [auth.userId]);
    if (adminRow.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    }
    const { email, name, title, accessType, accessUntil } = parsed.data;
    if (accessType !== 'unlimited' && !accessUntil) {
      return res.status(400).json({ error: 'invalid_input', message: 'accessUntil é obrigatório para esse tipo de acesso' });
    }
    const normalizedEmail = email.toLowerCase();

    const existing = await pool.query('select id from users where email = $1', [normalizedEmail]);
    if (existing.rowCount) {
      return res.status(409).json({ error: 'email_in_use' });
    }

    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const result = await pool.query(
      `insert into users (email, password_hash, name, title, role, access_type, access_until, must_change_password, email_verified_at)
       values ($1,$2,$3,$4,'client',$5,$6,true,now())
       returning *`,
      [normalizedEmail, passwordHash, name, title ?? null, accessType, accessType === 'unlimited' ? null : accessUntil]
    );

    const created = result.rows[0];
    logEvent(pool, { event: 'account_created', userId: created.id, email: created.email, message: `criada pela admin (${accessType})` });
    res.status(201).json(adminUserToJson(created));
  } catch (err) {
    if (err instanceof UnauthorizedError) return res.status(401).json({ error: 'unauthorized' });
    throw err;
  }
}

export default withErrorLog(handler);
