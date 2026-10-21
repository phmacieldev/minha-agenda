import webpush from 'web-push';
import type { Pool } from 'pg';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:contato@minhaagenda.app';
  if (!pub || !priv) throw new Error('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas');
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

interface Subscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// Manda a notificação pra uma inscrição; se o navegador avisar que ela não
// existe mais (410/404 — usuária desinstalou, limpou dados, trocou de
// aparelho), apaga a linha pra não ficar tentando pra sempre.
export async function sendPush(pool: Pool, sub: Subscription, payload: { title: string; body: string; url?: string }): Promise<boolean> {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await pool.query('delete from push_subscriptions where id = $1', [sub.id]);
    } else {
      console.error('[push] falha ao enviar', sub.id, err?.statusCode, err?.body);
    }
    return false;
  }
}
