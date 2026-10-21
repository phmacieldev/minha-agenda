import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getPool } from '../../lib/db';
import { getAuth, UnauthorizedError } from '../../lib/auth';
import { generateToken, hoursFromNow } from '../../lib/tokens';
import { sendEmail, verificationEmailHtml, resetPasswordEmailHtml } from '../../lib/email';
import { checkRateLimit, clientIp } from '../../lib/rateLimit';

const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().trim().min(6, 'Senha precisa ter pelo menos 6 caracteres'),
});

function resultPage(title: string, message: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
    <style>body{font:16px/1.5 -apple-system,sans-serif;max-width:420px;margin:15vh auto;padding:0 24px;text-align:center;color:#1e1b2e}
      h1{font-size:22px}</style></head>
    <body><h1>${title}</h1><p>${message}</p></body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const pool = getPool();

  // Confirma o e-mail a partir do link enviado (clicado no navegador).
  if (req.method === 'GET') {
    const token = typeof req.query.token === 'string' ? req.query.token : null;
    if (!token) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(resultPage('Link inválido', 'Esse link de confirmação está incompleto.'));
    }

    const result = await pool.query(
      `update users set email_verified_at = now(), verification_token = null, verification_token_expires_at = null
       where verification_token = $1 and verification_token_expires_at > now()
       returning id`,
      [token]
    );

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!result.rowCount) {
      return res.status(400).send(resultPage('Link expirado', 'Esse link de confirmação não é mais válido. Peça um novo dentro do app.'));
    }
    return res.status(200).send(resultPage('E-mail confirmado!', 'Pode fechar esta aba e voltar para o app.'));
  }

  // Pede o link de redefinição de senha (não exige estar logada — é exatamente
  // o caso de quem esqueceu a senha). Responde sempre igual, exista ou não a
  // conta, pra não deixar descobrir quais e-mails estão cadastrados.
  if (req.method === 'POST' && req.query.action === 'forgot') {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
    const email = parsed.data.email.toLowerCase();
    const ip = clientIp(req);
    const okIp = await checkRateLimit(pool, `forgot:ip:${ip}`, 8, 60 * 60 * 1000);
    const okEmail = await checkRateLimit(pool, `forgot:email:${email}`, 3, 60 * 60 * 1000);
    if (okIp && okEmail) {
      const userResult = await pool.query('select id, name, email from users where email = $1', [email]);
      if (userResult.rowCount) {
        const user = userResult.rows[0];
        const resetToken = generateToken();
        await pool.query(
          'update users set reset_token = $1, reset_token_expires_at = $2 where id = $3',
          [resetToken, hoursFromNow(2), user.id]
        );
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const resetUrl = `${appUrl}/?reset=${resetToken}`;
        await sendEmail({
          to: user.email,
          subject: 'Redefinir senha — Minha Agenda',
          html: resetPasswordEmailHtml(user.name, resetUrl),
        });
      }
    }
    return res.status(200).json({ sent: true });
  }

  // Confirma a nova senha a partir do token recebido por e-mail.
  if (req.method === 'POST' && req.query.action === 'reset') {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
    const { token, newPassword } = parsed.data;
    const userResult = await pool.query(
      'select id from users where reset_token = $1 and reset_token_expires_at > now()',
      [token]
    );
    if (!userResult.rowCount) return res.status(400).json({ error: 'invalid_token' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'update users set password_hash = $1, reset_token = null, reset_token_expires_at = null where id = $2',
      [passwordHash, userResult.rows[0].id]
    );
    return res.status(200).json({ ok: true });
  }

  // Reenvia o e-mail de verificação para a usuária logada.
  if (req.method === 'POST') {
    try {
      const auth = getAuth(req);
      const okResend = await checkRateLimit(pool, `verify-resend:${auth.userId}`, 3, 60 * 60 * 1000);
      if (!okResend) return res.status(429).json({ error: 'too_many_attempts' });
      const userResult = await pool.query('select id, email, name, email_verified_at from users where id = $1', [auth.userId]);
      if (!userResult.rowCount) return res.status(404).json({ error: 'not_found' });
      const user = userResult.rows[0];
      if (user.email_verified_at) return res.status(200).json({ alreadyVerified: true });

      const verificationToken = generateToken();
      await pool.query(
        'update users set verification_token = $1, verification_token_expires_at = $2 where id = $3',
        [verificationToken, hoursFromNow(24), user.id]
      );

      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const verifyUrl = `${appUrl}/api/auth/verify?token=${verificationToken}`;
      await sendEmail({
        to: user.email,
        subject: 'Confirme seu e-mail — Minha Agenda',
        html: verificationEmailHtml(user.name, verifyUrl),
      });
      return res.status(200).json({ sent: true });
    } catch (err) {
      if (err instanceof UnauthorizedError) return res.status(401).json({ error: 'unauthorized' });
      throw err;
    }
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ error: 'method_not_allowed' });
}
