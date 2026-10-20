# Minha Agenda

PWA de agenda de atendimentos para profissionais de saúde (fonoaudiologia, fisioterapia etc.) que atendem em clínicas e/ou particular. HTML + CSS + JS puro, sem build, sem dependências — tudo em `index.html`.

## Rodando localmente

```bash
npx serve .
```

Abra o endereço mostrado (ex. `http://localhost:3000`) no navegador. Para testar como PWA no iPhone, acesse pelo Safari e use "Adicionar à Tela de Início".

> Não abra `index.html` direto com `file://` para testar o service worker — ele só funciona servido por `http://` ou `https://`.

## Publicando

O projeto é um site estático (sem servidor). Qualquer host estático serve (Vercel, Netlify, GitHub Pages...).

Publicado na Vercel em **https://minha-agenda-coral.vercel.app**, conectado ao repositório no GitHub: todo `git push` para `master` dispara um deploy automático de produção. Não é mais necessário rodar `vercel` manualmente.

## Testes de regressão

Um teste leve com Playwright cobre o fluxo principal (carregar o app, usar "Ver com exemplos", agendar um atendimento com convênio novo, editar um horário, gerar relatório semanal) e falha se aparecer qualquer erro no console. Viewport simula um iPhone 13 (390×844).

```bash
npm install
npx playwright install webkit
npm test
```

## Estrutura

- `index.html` — app inteiro (HTML + CSS + JS)
- `manifest.json` — manifesto do PWA
- `sw.js` — service worker (cache network-first); **incremente a constante `C` a cada deploy** para invalidar o cache dos usuários
- `icon-180/192/512.png` — ícones do app
- `api/` — backend em TypeScript (Vercel serverless functions), ver abaixo
- `lib/` — código compartilhado do backend (conexão com o banco, autenticação)
- `supabase/schema.sql` — schema do Postgres (usado tanto pelo Docker local quanto pelo Supabase de produção)
- `docker-compose.yml` — Postgres local para desenvolvimento (`npm run db:up`)

## Dados (hoje)

Tudo fica salvo no `localStorage` do navegador, na chave `minha-agenda-v1` — nada é enviado para servidor nenhum. Cada profissional faz seu próprio cadastro (nome, locais, convênios) no onboarding. A sincronização na nuvem (ver `PLANO.md`) está sendo construída em paralelo, sem tirar o app do ar: o front ainda não fala com a API.

## Backend (em construção)

API em TypeScript rodando como Vercel Serverless Functions, usando o Supabase só como Postgres gerenciado (sem Supabase Auth/RLS — autenticação e isolamento por usuária são feitos pela própria API).

### Ambientes: local × produção (nunca se misturam)

| | Local (desenvolvimento) | Produção |
|---|---|---|
| Banco | Postgres no Docker, só na sua máquina | Supabase (nuvem) |
| Variáveis | `.env` (não commitado) | Vercel → Settings → Environment Variables |
| Dados | só os seus testes | dados reais das usuárias |

O banco local e o de produção **não têm nenhuma comunicação entre si**. Rodar `vercel dev` na sua máquina nunca deve tocar no banco de produção — se `DATABASE_URL` estiver apontando pro Supabase, está configurado errado. A conexão escolhe SSL automaticamente pelo host (desligado para `localhost`, ligado para qualquer outro) — não precisa mexer nisso.

**Configuração local (uma vez):**

1. Tenha o [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e aberto.
2. Copie `.env.example` para `.env` (os valores padrão já apontam para o banco local — não precisa editar nada pra começar). Essa versão do `vercel dev` lê `.env`, não `.env.local` (o `.vercel link` pode criar um `.env.local` sozinho; se isso acontecer, confira se ele também aponta pro banco local e não para o Supabase).
3. `npm install`
4. `npm run dev:api` — um script (`scripts/dev.js`) sobe o Postgres local no Docker automaticamente (esperando ficar saudável), aplica `supabase/schema.sql` sozinho na primeira vez (volume vazio), e só depois inicia a API via `vercel dev`. Ao encerrar (Ctrl+C), o container é parado também.
5. `npm run typecheck` — confere os tipos sem gerar build.

Se mudar o schema (`supabase/schema.sql`) depois de já ter subido o banco uma vez, rode `npm run db:reset` para recriar o volume do zero com o schema novo (isso apaga os dados locais de teste — é só o banco de desenvolvimento).

**Configuração de produção (feita uma vez, pelo quem administra o projeto):**

1. Crie um projeto no [supabase.com](https://supabase.com) (free tier, região São Paulo — `sa-east-1`).
2. Em *SQL Editor*, rode o conteúdo de `supabase/schema.sql`.
3. Em *Project Settings → Database → Connection string*, copie a opção **Transaction pooler** (não a "URI" direta — ela só resolve por IPv6 e a Vercel não tem saída IPv6, dá `ENOTFOUND`).
4. Cadastre `DATABASE_URL` (com a senha do banco) e `JWT_SECRET` (uma string longa aleatória, diferente da usada em local) em Vercel → Settings → Environment Variables → **Production** (e Preview, se quiser deploys de preview funcionais). Nunca cole esses valores em nenhum arquivo do repositório.

**Endpoints prontos até agora** (todos sob `/api`; os de CRUD usam `?id=` em vez de segmento de rota, porque o plano Hobby da Vercel limita a 12 Serverless Functions por deployment — um `index.ts` por recurso cuida de lista/criação/leitura/atualização/exclusão em vez de dois arquivos por recurso):

- `GET /api/health` — ping
- `POST /api/auth/signup` — `{ email, password, name, title? }` → `{ token }`. Cria a usuária (senha com bcrypt) e dispara um e-mail de confirmação (best-effort — se o envio falhar, a conta é criada do mesmo jeito).
- `POST /api/auth/login` — `{ email, password }` → `{ token }`
- `GET /api/auth/me` — header `Authorization: Bearer <token>` → dados da usuária logada, incluindo `emailVerified`
- `GET /api/auth/verify?token=<token>` — confirma o e-mail (é o link que vem no e-mail; retorna uma página HTML simples, não JSON)
- `POST /api/auth/verify` — header `Authorization: Bearer <token>` → reenvia o e-mail de confirmação para quem ainda não confirmou
- `PUT` ou `PATCH /api/auth/me` — header `Authorization: Bearer <token>`, body `{ name?, title? }` → atualiza o perfil
- `PUT` ou `PATCH /api/auth/me?action=password` — body `{ currentPassword, newPassword }` → troca a senha
- `places`, `patients`, `appts`, `insurers`, `exceptions`, `records` — todos com o mesmo padrão, exigindo `Authorization: Bearer <token>`:
  - `GET /api/{recurso}` — lista (appts e exceptions aceitam `?from=YYYY-MM-DD&to=YYYY-MM-DD`; appts também aceita `?placeId=`; records aceita `?patientId=`)
  - `GET /api/{recurso}?id=<id>` — um item
  - `POST /api/{recurso}` — cria (upsert por `id`, se enviado)
  - `PUT` ou `PATCH /api/{recurso}?id=<id>` — atualiza (campos parciais)
  - `DELETE /api/{recurso}?id=<id>` — remove
- `GET /api/cron/backup` — disparado automaticamente 1x/dia pela Vercel Cron (ver abaixo); não é pra usar manualmente

**E-mail transacional:** usa [Resend](https://resend.com) (free tier). Sem `RESEND_API_KEY` configurada, o envio só fica registrado no log — não trava nada, então não é obrigatório para rodar local. Para testar de verdade: crie uma conta no Resend, pegue a API key, e configure `RESEND_API_KEY` (local: `.env`; produção: Vercel). `APP_URL` é usada para montar o link do e-mail (local já vem certo por padrão; em produção, configure como `https://minha-agenda-coral.vercel.app`).

**Backup automático do banco:** a Vercel Cron chama `/api/cron/backup` 1x por dia (07:00 UTC — o plano Hobby só permite 1x/dia mesmo), que salva um dump de todas as tabelas como uma linha JSON na própria tabela `backups` e apaga cópias além das últimas 14 (duas semanas), pra nunca crescer sem limite. É uma rede de segurança a nível de banco — separado do botão "Salvar cópia agora" em Ajustes, que é a cópia local (JSON) que a própria usuária guarda no celular/nuvem pessoal.

Nunca commite `.env` nem `.env.local` — já estão no `.gitignore`.
