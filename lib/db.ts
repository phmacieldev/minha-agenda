import { Pool, types } from 'pg';

// Datas (OID 1082) voltam como string 'YYYY-MM-DD' pura, sem o driver
// converter para JS Date — isso evita bugs de fuso horário (um Date em UTC
// pode exibir o dia errado dependendo do horário local de quem lê).
types.setTypeParser(1082, (val) => val);

let pool: Pool | null = null;

function needsSsl(connectionString: string): boolean {
  try {
    const { hostname } = new URL(connectionString.replace(/^postgres(ql)?:\/\//, 'http://'));
    // Postgres local (Docker) não tem SSL habilitado; bancos gerenciados
    // (Supabase etc.) exigem. Detecta pelo host em vez de precisar de mais
    // uma variável de ambiente.
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return true;
  }
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL não configurada');
    pool = new Pool({
      connectionString,
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : false,
      max: 3,
    });
  }
  return pool;
}
