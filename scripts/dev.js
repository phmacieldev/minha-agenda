#!/usr/bin/env node
// Sobe o Postgres local (Docker) antes da API e derruba ao sair.
// A criação do schema na primeira vez é automática: a imagem do Postgres
// roda supabase/schema.sql sozinha quando o volume de dados está vazio
// (ver docker-entrypoint-initdb.d em docker-compose.yml).
const { spawn, spawnSync } = require('child_process');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  return r.status === 0;
}

console.log('Subindo o banco local (Docker)...');
if (!run('docker', ['compose', 'up', '-d', '--wait'])) {
  console.error('\nNão consegui subir o Postgres local. O Docker Desktop está aberto e rodando?');
  process.exit(1);
}
console.log('Banco local pronto.\n');

const child = spawn('npx', ['vercel', 'dev'], { stdio: 'inherit', shell: true });

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  console.log('\nParando o banco local...');
  spawnSync('docker', ['compose', 'stop'], { stdio: 'inherit', shell: true });
  process.exit(code ?? 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
child.on('exit', (code) => shutdown(code ?? 0));
