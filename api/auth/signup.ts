import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { signToken } from '../../lib/auth';
import { generateToken, hoursFromNow } from '../../lib/tokens';
import { sendEmail, verificationEmailHtml } from '../../lib/email';

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
  const verificationToken = generateToken();
  const result = await pool.query(
    `insert into users (email, password_hash, name, title, verification_token, verification_token_expires_at)
     values ($1,$2,$3,$4,$5,$6) returning id, email`,
    [normalizedEmail, passwordHash, name, title ?? null, verificationToken, hoursFromNow(24)]
  );
  const user = result.rows[0];
  const token = signToken({ userId: user.id, email: user.email });

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const verifyUrl = `${appUrl}/api/auth/verify?token=${verificationToken}`;
  try {
    await sendEmail({
      to: user.email,
      subject: 'Confirme seu e-mail — Minha Agenda',
      html: verificationEmailHtml(name, verifyUrl),
    });
  } catch (err) {
    // Conta já foi criada; não falha o cadastro se o e-mail não sair.
    console.error('[signup] falha ao enviar e-mail de verificação', err);
  }

  res.status(201).json({ token });
}
