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
- `supabase/schema.sql` — schema do Postgres

## Dados (hoje)

Tudo fica salvo no `localStorage` do navegador, na chave `minha-agenda-v1` — nada é enviado para servidor nenhum. Cada profissional faz seu próprio cadastro (nome, locais, convênios) no onboarding. A sincronização na nuvem (ver `PLANO.md`) está sendo construída em paralelo, sem tirar o app do ar: o front ainda não fala com a API.

## Backend (em construção)

API em TypeScript rodando como Vercel Serverless Functions, usando o Supabase só como Postgres gerenciado (sem Supabase Auth/RLS — autenticação e isolamento por usuária são feitos pela própria API).

**Configuração local:**

1. Crie um projeto no [supabase.com](https://supabase.com) (free tier, região São Paulo — `sa-east-1`).
2. Em *SQL Editor*, rode o conteúdo de `supabase/schema.sql`.
3. Em *Project Settings → Database → Connection string → URI*, copie a connection string.
4. Copie `.env.example` para `.env.local` e preencha `DATABASE_URL` (com a senha do banco) e `JWT_SECRET` (qualquer string longa aleatória).
5. `npm install`
6. `npm run dev:api` — sobe a API localmente via `vercel dev`.
7. `npm run typecheck` — confere os tipos sem gerar build.

**Endpoints prontos até agora:**

- `GET /api/health` — ping
- `POST /api/auth/signup` — `{ email, password, name, title? }` → `{ token }`
- `POST /api/auth/login` — `{ email, password }` → `{ token }`
- `GET /api/auth/me` — header `Authorization: Bearer <token>` → dados da usuária logada

Nunca commite `.env.local` — ele já está no `.gitignore`.
