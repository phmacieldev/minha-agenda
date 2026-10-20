# Minha Agenda

PWA de agenda de atendimentos para profissionais de saúde (fonoaudiologia, fisioterapia etc.) que atendem em clínicas e/ou particular. HTML + CSS + JS puro, sem build, sem dependências — tudo em `index.html`.

## Rodando localmente

```bash
npx serve .
```

Abra o endereço mostrado (ex. `http://localhost:3000`) no navegador. Para testar como PWA no iPhone, acesse pelo Safari e use "Adicionar à Tela de Início".

> Não abra `index.html` direto com `file://` para testar o service worker — ele só funciona servido por `http://` ou `https://`.

## Publicando

O projeto é um site estático (sem servidor). Qualquer host estático serve (Vercel, Netlify, GitHub Pages...). Para publicar na Vercel:

```bash
npx vercel        # preview
npx vercel --prod # produção
```

## Estrutura

- `index.html` — app inteiro (HTML + CSS + JS)
- `manifest.json` — manifesto do PWA
- `sw.js` — service worker (cache network-first); **incremente a constante `C` a cada deploy** para invalidar o cache dos usuários
- `icon-180/192/512.png` — ícones do app

## Dados

Tudo fica salvo no `localStorage` do navegador, na chave `minha-agenda-v1` — nada é enviado para servidor nenhum. Cada profissional faz seu próprio cadastro (nome, locais, convênios) no onboarding.
