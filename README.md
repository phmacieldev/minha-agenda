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

## Dados

Tudo fica salvo no `localStorage` do navegador, na chave `minha-agenda-v1` — nada é enviado para servidor nenhum. Cada profissional faz seu próprio cadastro (nome, locais, convênios) no onboarding.
