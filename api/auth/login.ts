import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { signToken } from '../../lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const pool = getPool();
  const result = await pool.query(
    'select id, email, password_hash from users where email = $1',
    [email.toLowerCase()]
  );
  const user = result.rows[0];
  // Mesma mensagem genérica se o e-mail não existir ou a senha estiver errada,
  // para não revelar quais e-mails têm conta.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const token = signToken({ userId: user.id, email: user.email });
  res.status(200).json({ token });
}
