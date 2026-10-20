import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from '../../lib/db';
import { getAuth, UnauthorizedError } from '../../lib/auth';
import { generateToken, hoursFromNow } from '../../lib/tokens';
import { sendEmail, verificationEmailHtml } from '../../lib/email';

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

  // Reenvia o e-mail de verificação para a usuária logada.
  if (req.method === 'POST') {
    try {
      const auth = getAuth(req);
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
