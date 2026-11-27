import type { Pool } from 'pg';

export interface LogEventInput {
  level?: 'info' | 'warn' | 'error';
  event: string;
  userId?: string | null;
  email?: string | null;
  message?: string;
}

// Nunca deixa um problema ao gravar o log quebrar a requisição que o
// originou — o log é só observabilidade, não pode virar um ponto de falha.
export async function logEvent(pool: Pool, input: LogEventInput): Promise<void> {
  try {
    await pool.query(
      `insert into admin_logs (level, event, user_id, email, message) values ($1,$2,$3,$4,$5)`,
      [input.level || 'info', input.event, input.userId ?? null, input.email ?? null, input.message ?? null]
    );
  } catch (err) {
    console.error('[adminLog] falhou ao gravar evento', input.event, err);
  }
}
