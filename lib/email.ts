// Camada de envio de e-mail, isolada atrás de uma função — trocar de provedor
// (Resend → outro) significa mudar só este arquivo, nada que o chama precisa saber.

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Minha Agenda <onboarding@resend.dev>';

  if (!apiKey) {
    // Sem provedor configurado (ex. ambiente local sem conta no Resend):
    // não falha o fluxo, só avisa — assim `npm run dev:api` funciona sem
    // precisar de uma conta de e-mail de verdade.
    console.warn(`[email] RESEND_API_KEY não configurada — e-mail para ${to} não foi enviado ("${subject}").`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[email] Falha ao enviar para ${to}: ${res.status} ${body}`);
  }
}

export function verificationEmailHtml(name: string, verifyUrl: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#C2256A">Minha Agenda</h2>
      <p>Olá, ${name}!</p>
      <p>Confirme seu e-mail para ativar sua conta:</p>
      <p><a href="${verifyUrl}" style="display:inline-block;background:#C2256A;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Confirmar e-mail</a></p>
      <p style="color:#666;font-size:13px">Se você não criou essa conta, pode ignorar este e-mail.</p>
    </div>
  `;
}

export function resetPasswordEmailHtml(name: string, resetUrl: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#C2256A">Minha Agenda</h2>
      <p>Olá, ${name}!</p>
      <p>Alguém (provavelmente você) pediu pra trocar a senha dessa conta. Toque no botão abaixo pra escolher uma nova senha:</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#C2256A;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Trocar senha</a></p>
      <p style="color:#666;font-size:13px">Esse link vale por 2 horas. Se não foi você, pode ignorar este e-mail — sua senha continua a mesma.</p>
    </div>
  `;
}
