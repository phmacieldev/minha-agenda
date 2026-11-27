// Carrega o .env local (mesma fonte que scripts/local-server.ts usa) pros
// testes de integração conseguirem abrir o Pool do Postgres e ler
// JWT_SECRET — sem isso, rodar `vitest` direto (fora do fluxo `npm run dev:api`)
// não teria essas variáveis no processo.
import path from 'node:path';
import { existsSync } from 'node:fs';

const envPath = path.resolve(__dirname, '..', '.env');
if (existsSync(envPath) && !process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // ambiente sem suporte a loadEnvFile (Node < 20.6) — segue sem, os
    // testes de integração vão falhar com uma mensagem clara sobre DATABASE_URL.
  }
}
