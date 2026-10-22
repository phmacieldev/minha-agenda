#!/usr/bin/env node
// Simulacro de restauração de backup: gera um snapshot igual ao que o cron
// faz, grava na tabela `backups`, e restaura esse snapshot num banco
// TEMPORÁRIO separado (nunca mexe no banco em uso), conferindo se as
// contagens batem. Roda só contra DATABASE_URL local — nunca aponte isso
// pra produção.
const { Pool } = require('pg');

const SRC_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/minha_agenda';
const TMP_DB = 'minha_agenda_restore_drill';
const TABLES = ['users', 'places', 'insurers', 'patients', 'records', 'appts', 'exceptions'];

function adminUrl(url, dbName) {
  const u = new URL(url.replace(/^postgres(ql)?:\/\//, 'http://'));
  u.pathname = '/' + dbName;
  return u.toString().replace(/^http:\/\//, 'postgres://');
}

async function main() {
  if (/supabase|pooler|sa-east/i.test(SRC_URL)) {
    console.error('DATABASE_URL parece apontar pra produção/Supabase — abortando por segurança.');
    process.exit(1);
  }

  const src = new Pool({ connectionString: SRC_URL });

  console.log('1) Lendo tabelas do banco local, igual o cron de backup faz...');
  const data = {};
  for (const t of TABLES) {
    const r = await src.query(`select * from ${t}`);
    data[t] = r.rows;
  }
  console.log('   ' + TABLES.map((t) => `${t}: ${data[t].length}`).join(' · '));

  console.log('2) Gravando o snapshot na tabela backups (igual produção faria)...');
  const { randomUUID } = require('crypto');
  const backupId = randomUUID();
  await src.query('insert into backups (id, data) values ($1, $2)', [backupId, JSON.stringify(data)]);
  console.log('   backup id: ' + backupId);

  console.log('3) Lendo esse backup de volta (como uma restauração real leria)...');
  const back = await src.query('select data from backups where id = $1', [backupId]);
  const restored = back.rows[0].data;

  console.log(`4) Criando banco temporário "${TMP_DB}" pra restaurar de verdade...`);
  const admin = new Pool({ connectionString: adminUrl(SRC_URL, 'postgres') });
  await admin.query(`drop database if exists ${TMP_DB}`);
  await admin.query(`create database ${TMP_DB}`);
  await admin.end();

  const fs = require('fs');
  const path = require('path');
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  const tmp = new Pool({ connectionString: adminUrl(SRC_URL, TMP_DB) });
  await tmp.query(schemaSql);

  console.log('5) Restaurando os dados no banco temporário...');
  // Ordem importa por causa das foreign keys: users antes de tudo, patients
  // antes de records, etc. A ordem de TABLES já respeita isso.
  for (const t of TABLES) {
    for (const row of restored[t]) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => row[c]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      await tmp.query(
        `insert into ${t} (${cols.join(',')}) values (${placeholders})`,
        vals
      );
    }
  }

  console.log('6) Conferindo se as contagens batem...');
  let allOk = true;
  for (const t of TABLES) {
    const r = await tmp.query(`select count(*)::int as n from ${t}`);
    const ok = r.rows[0].n === data[t].length;
    if (!ok) allOk = false;
    console.log(`   ${t}: backup tinha ${data[t].length}, restaurado tem ${r.rows[0].n} ${ok ? '✓' : '✗ DIVERGIU'}`);
  }

  console.log('7) Limpando o banco temporário e o backup de teste...');
  await tmp.end();
  const admin2 = new Pool({ connectionString: adminUrl(SRC_URL, 'postgres') });
  await admin2.query(`drop database if exists ${TMP_DB}`);
  await admin2.end();
  await src.query('delete from backups where id = $1', [backupId]);
  await src.end();

  console.log(allOk ? '\n✅ Restauração testada com sucesso — contagens batem.' : '\n❌ Alguma tabela divergiu, ver acima.');
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('Erro no teste de restauração:', err);
  process.exit(1);
});
