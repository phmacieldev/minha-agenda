// As chamadas de login/forgot-password passam por rate limiting por IP (ver
// lib/rateLimit.ts). Um `fetch` do Node não manda `x-forwarded-for`, então
// toda a suíte (e qualquer teste manual feito via curl na mesma máquina)
// cai no mesmo balde "login:ip:unknown" — sessões de teste muito seguidas
// esgotam o limite antes mesmo de começar. Cada arquivo de teste de
// integração chama isto no próprio beforeAll, em vez de depender de lembrar
// de limpar isso manualmente.
import { getPool } from '../../lib/db';

export async function clearLoginRateLimit(): Promise<void> {
  const pool = getPool();
  await pool.query("delete from rate_limits where key like 'login:%' or key like 'forgot:%'");
}
