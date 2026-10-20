import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { signToken } from '../../lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().trim().min(6, 'Senha precisa ter pelo menos 6 caracteres'),
  name: z.string().min(1),
  title: z.string().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }
  const { email, password, name, title } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const pool = getPool();
  const existing = await pool.query('select id from users where email = $1', [normalizedEmail]);
  if (existing.rowCount) {
    return res.status(409).json({ error: 'email_in_use' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    'insert into users (email, password_hash, name, title) values ($1,$2,$3,$4) returning id, email',
    [normalizedEmail, passwordHash, name, title ?? null]
  );
  const user = result.rows[0];
  const token = signToken({ userId: user.id, email: user.email });
  res.status(201).json({ token });
}
