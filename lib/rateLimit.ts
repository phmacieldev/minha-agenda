import type { Pool } from 'pg';
import type { VercelRequest } from '@vercel/node';

// Limitador simples guardado no próprio Postgres (sem depender de Redis/Upstash
// — o volume do projeto não justifica mais uma peça de infra). Uma linha por
// chave (ex. "login:ip:1.2.3.4"), reaproveitada enquanto a janela não vence.
export async function checkRateLimit(pool: Pool, key: string, limit: number, windowMs: number): Promise<boolean> {
  const resetAt = new Date(Date.now() + windowMs);
  const result = await pool.query(
    `insert into rate_limits (key, count, reset_at) values ($1, 1, $2)
     on conflict (key) do update set
       count = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then excluded.reset_at else rate_limits.reset_at end
     returning count`,
    [key, resetAt]
  );
  return result.rows[0].count <= limit;
}

export function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const ip = raw ? raw.split(',')[0].trim() : '';
  return ip || 'unknown';
}
