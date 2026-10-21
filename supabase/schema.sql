-- Minha Agenda — schema do backend (Supabase usado só como Postgres gerenciado)
-- Autenticação e isolamento por usuária são feitos pela API (não pelo Supabase Auth/RLS),
-- já que o Postgres só é acessado pela nossa API com uma connection string de servidor.

create extension if not exists pgcrypto; -- gen_random_uuid()

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null,
  title text,
  created_at timestamptz not null default now()
);

-- Verificação de e-mail. `alter ... add column if not exists` em vez de um
-- migrador dedicado (ex. node-pg-migrate) porque o projeto ainda é pequeno;
-- reavaliar se o schema crescer mais. Rodar este arquivo de novo em um banco
-- que já tem a tabela `users` só adiciona o que falta, não apaga nada.
alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists verification_token text;
alter table users add column if not exists verification_token_expires_at timestamptz;

-- Dados do perfil usados na hora de montar os relatórios/documentos.
alter table users add column if not exists reg_number text;
alter table users add column if not exists signature text; -- imagem (data URL) comprimida no cliente

create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  color text not null default 'p1',
  kind text not null default 'clinica',
  address text default '',
  price numeric(10,2) not null default 0,
  duration int not null default 50,
  hours jsonb not null default '{}'::jsonb,
  info text default '',
  msg text,
  created_at timestamptz not null default now()
);
create index if not exists places_user_id_idx on places(user_id);
-- Modelo timbrado deste local, usado no topo dos relatórios/guias gerados.
alter table places add column if not exists letterhead text;

create table if not exists insurers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0,
  prices jsonb not null default '{}'::jsonb
);
create index if not exists insurers_user_id_idx on insurers(user_id);

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  phone text default '',
  notes text default '',
  pay text default 'particular',
  insurer_id uuid references insurers(id) on delete set null,
  birth date,
  sex text,
  mother text,
  father text,
  card text,
  diag text,
  created_at timestamptz not null default now()
);
create index if not exists patients_user_id_idx on patients(user_id);

create table if not exists records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  date date not null,
  place_id uuid references places(id) on delete set null,
  appt_id uuid,
  text text not null default ''
);
create index if not exists records_patient_id_idx on records(patient_id);

create table if not exists appts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  place_id uuid not null references places(id) on delete cascade,
  date date not null,
  time text not null,
  dur int not null default 50,
  price numeric(10,2) not null default 0,
  pay text not null default 'particular',
  insurer_id uuid references insurers(id) on delete set null,
  ins_name text,
  status text not null default 'agendado',
  paid boolean not null default false,
  notes text default '',
  created_at timestamptz not null default now()
);
create index if not exists appts_user_id_idx on appts(user_id);
create index if not exists appts_date_idx on appts(user_id, date);

create table if not exists exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date date not null,
  place_id uuid references places(id) on delete cascade,
  type text not null,
  all_day boolean not null default false,
  s text,
  e text,
  note text default ''
);
create index if not exists exceptions_user_id_idx on exceptions(user_id);

-- Cópia de segurança automática de todo o banco (ver api/cron/backup.ts), guardada
-- na própria base. Mantém só as últimas N linhas (o endpoint faz a limpeza), então
-- o espaço ocupado fica sempre pequeno e previsível.
create table if not exists backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists backups_created_at_idx on backups(created_at desc);
