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
  // para não revelar quais e-mails têm conta. Sempre roda o bcrypt.compare
  // (contra um hash fixo quando a usuária não existe) para não vazar essa
  // informação pelo tempo de resposta.
  const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8y2M9VX9f6V7z0g5l4R0w1XqS6Z2Nq';
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const token = signToken({ userId: user.id, email: user.email });
  res.status(200).json({ token });
}
