# Plano: sincronização na nuvem para o Minha Agenda

> Documento de planejamento. Nada aqui foi implementado — é a base para decidirmos o caminho antes de mexer em código.

## 1. Por que sincronizar

Hoje os dados (`localStorage`, chave `minha-agenda-v1`) vivem só no aparelho. Isso trava duas coisas que o produto precisa:

- **Replicação para outras profissionais**: cada uma tem seu próprio cadastro isolado, mas se trocar de celular ou quebrar o aparelho, perde tudo.
- **Continuidade**: sem backup automático, o aviso de "7 dias sem cópia" é a única rede de segurança.

O objetivo da sincronização é: dado continua funcionando offline (o app não pode depender de internet no consultório), mas passa a ter uma cópia na nuvem, por profissional, sincronizada quando há conexão.

## 2. Duas opções

### Opção A — Supabase (managed, região São Paulo)

**O que é**: Postgres gerenciado + autenticação + API REST/Realtime geradas automaticamente + Row Level Security (RLS) nativo do Postgres para isolar dados por usuária.

**Arquitetura proposta**

```
App (Vite + TS)  ──offline-first──▶  IndexedDB/localStorage (cache local)
       │                                        │
       │                              fila de alterações pendentes
       │                                        │
       └──────────── sync quando online ───────▶ Supabase (Postgres + RLS)
                                                  região sa-east-1 (São Paulo)
```

- **Auth**: e-mail + senha ou magic link (Supabase Auth). Cada profissional = 1 usuária (`auth.users`), `user_id` em toda tabela de domínio (`places`, `patients`, `appts`, `insurers`, `exceptions`).
- **RLS**: política `user_id = auth.uid()` em cada tabela — o Postgres recusa qualquer leitura/escrita fora dos dados da própria usuária, mesmo que a chave da API vaze. É a camada de isolamento mais forte disponível sem escrever backend.
- **Offline-first**: mantém o padrão atual de "salvar local primeiro, sincronizar depois". Cada escrita local grava também numa tabela `sync_queue` (ou um campo `dirty`/`updated_at`); quando a conexão volta, um worker envia as alterações pendentes e baixa o que mudou no servidor desde o último `updated_at` conhecido (sync incremental simples, não é preciso CRDT para o volume de dados de uma agenda pessoal).
- **Conflitos**: dado o uso (uma profissional, poucos dispositivos, baixa concorrência), "last-write-wins" por campo com timestamp é suficiente — não precisa de resolução de conflito sofisticada agora.
- **Migração dos dados locais**: no primeiro login, o app lê o `localStorage` existente e faz upload em lote (um `insert` por tabela, dentro de uma transação) antes de ligar a sincronização contínua. Preserva tudo que já existe no aparelho.

**LGPD (dados de saúde = dados sensíveis, Art. 5º/11 da LGPD)**

- **Base legal**: tutela da saúde (Art. 11, II, "f") cobre o registro clínico em si; ainda assim, vale pedir consentimento explícito no onboarding para o *armazenamento na nuvem* (é uma finalidade adicional ao prontuário em papel/local).
- **Criptografia**: em trânsito, TLS por padrão (Supabase já serve tudo em HTTPS). Em repouso, o Postgres do Supabase já criptografa o disco; para campos mais sensíveis (diagnóstico, evolução), dá para considerar criptografia de aplicação (ex. `pgsodium`/`pgcrypto`) — custo de complexidade maior, pode ficar para uma fase 2.
- **Exclusão de conta**: endpoint que apaga (ou anonimiza) todos os registros da usuária sob pedido. Atenção: normas do CFM sobre guarda de prontuário podem exigir retenção mínima mesmo após pedido de exclusão — vale checar com um profissional jurídico antes de implementar exclusão automática irrestrita.
- **Exportação**: já existe (backup JSON) — manter e estender para incluir também o que está só na nuvem.
- **RIPD (Relatório de Impacto)**: não é obrigatório pelo volume esperado (poucas profissionais, não é tratamento em larga escala), mas documentar as decisões de segurança já ajuda se o produto crescer.

**Custo estimado**

- Plano **Free**: 500 MB de banco, 50 mil usuárias ativas/mês, 2 projetos — dá para rodar o piloto com a namorada + algumas amigas de graça. Risco: projeto pausa após 7 dias sem uso (aceitável em fase de teste, não em produção).
- Plano **Pro**: US$25/mês (+ uso excedente) quando sair do piloto — banco de 8 GB, sem pausa automática. Para o volume de uma agenda de atendimentos (texto, sem anexos pesados), isso cobre dezenas de profissionais por anos.
- Não há tier regional diferenciado conhecido — o preço é o mesmo escolhendo `sa-east-1` (São Paulo) ou qualquer outra região; a região só afeta latência, não custo.

**Esforço estimado**: 2–3 semanas de um desenvolvedor (migração para Vite+TS já embutida nesse esforço, já que o projeto será modularizado nessa fase).

**Prós**
- Sem servidor para manter (deploy, patch de segurança, escalabilidade ficam por conta do Supabase).
- RLS dá isolamento por usuária "de graça", no banco — menos chance de bug vazar dado entre profissionais.
- Auth pronta (recuperação de senha, confirmação de e-mail) sem escrever nada disso.
- Free tier cobre o piloto sem custo.

**Contras**
- Vendor lock-in parcial (embora seja Postgres puro por baixo, então migrar para outro Postgres gerenciado no futuro é viável).
- Menos controle fino sobre lógica de negócio no servidor (ainda dá para usar Edge Functions quando precisar de lógica custom, mas é outro paradigma).

---

### Opção B — Backend próprio (Java/Spring Boot + PostgreSQL)

**Arquitetura proposta**

```
App (Vite + TS) ──offline-first──▶ cache local
       │                                  │
       └── REST/JSON (JWT) ──────────────▶ API Spring Boot
                                                 │
                                           PostgreSQL gerenciado
                                           (ex. Railway, Supabase só-banco, RDS)
```

- **Auth**: Spring Security + JWT, ou Keycloak se quiser algo pronto (mais um serviço para manter). Login por e-mail/senha, hash com BCrypt.
- **Isolamento por usuária**: feito manualmente em cada query/repository (`WHERE user_id = :userId`) ou via filtro no nível do Hibernate — mais código, mais superfície para esquecer um filtro e vazar dado entre profissionais (o RLS do Postgres evita essa classe de bug; aqui ela volta a existir).
- **Offline-first / sync**: mesma lógica de fila e `updated_at`, só que a API precisa ser escrita à mão (endpoints de sync em lote, resolução de conflito).
- **Deploy**: precisa de um host para o Spring Boot (Railway, Render, Fly.io, ou AWS/GCP "de verdade"), mais um Postgres gerenciado separado, mais CI/CD, mais monitoramento (logs, uptime), mais gestão de certificado/HTTPS se for VPS própria.

**LGPD**: as mesmas obrigações da Opção A, mas toda a responsabilidade de infraestrutura (patch de SO, backup do banco, criptografia em repouso, controle de acesso ao servidor) passa a ser sua, não do provedor. Isso é mais trabalho e mais risco de configuração errada.

**Custo estimado**
- Host da API (Railway/Render, tier pago básico): ~US$5–20/mês.
- Postgres gerenciado separado: ~US$7–25/mês (ou usar o mesmo host, se suportar).
- Total: US$15–45/mês, dependendo do provedor — na prática, parecido ou mais caro que o Pro do Supabase, com mais peças para manter no ar.

**Esforço estimado**: 6–10 semanas de um desenvolvedor — escrever a API inteira (entidades, auth, endpoints de sync, testes), configurar infraestrutura e CI/CD, e só depois migrar o frontend. Pelo menos 3x o esforço da Opção A para chegar no mesmo resultado funcional.

**Prós**
- Controle total sobre a lógica de negócio e a infraestrutura.
- Nenhuma dependência de um fornecedor externo de BaaS.
- Faz sentido se o produto crescer para precisar de lógica de servidor complexa (ex. integrações com convênios, faturamento automatizado) que não cabe bem num BaaS.

**Contras**
- Muito mais trabalho para o mesmo resultado inicial.
- Você vira responsável por tudo que o Supabase resolveria sozinho: patches de segurança, backups, uptime, scaling.
- Maior risco de erro de isolamento de dados (sem RLS nativo).
- Mais caro ou equivalente em custo de infraestrutura, com uma fração do tempo de desenvolvimento investido em "reinventar" o que um BaaS já oferece.

---

## 3. Comparação lado a lado

| | Supabase | Backend próprio (Spring Boot) |
|---|---|---|
| Esforço inicial | 2–3 semanas | 6–10 semanas |
| Custo mensal (piloto) | R$ 0 (free tier) | ~R$ 75–225 (US$15–45) |
| Custo mensal (produção pequena) | US$25+ | US$15–45+ |
| Isolamento de dados | RLS no banco (forte, automático) | Manual, por código |
| Infra a manter | Nenhuma | Servidor + banco + CI/CD |
| Auth pronta | Sim | Não (escrever ou integrar Keycloak) |
| Região São Paulo | Sim (`sa-east-1`) | Depende do provedor escolhido |
| Flexibilidade de lógica custom | Edge Functions (limitado) | Total |
| Risco de vendor lock-in | Baixo (Postgres puro por baixo) | Nenhum |

## 4. Recomendação

**Supabase.** Para o estágio atual do produto (uma usuária real + replicação para amigas, sem volume alto, sem lógica de negócio complexa no servidor), o backend próprio custa 3x mais tempo de desenvolvimento para entregar a mesma coisa, com mais responsabilidade operacional e mais risco de bug de isolamento de dados — justamente o tipo de erro mais grave possível com dados de saúde. O Supabase cobre auth, isolamento via RLS, banco gerenciado e região no Brasil "de fábrica".

Fica a porta aberta para migrar depois: como o Supabase é Postgres puro, se um dia o produto precisar de lógica de servidor que não cabe em Edge Functions, dá para apontar um backend próprio para o mesmo banco (ou migrar o banco inteiro) sem reescrever o modelo de dados do zero.

## 5. Fases de implementação (quando formos implementar)

1. Migrar `index.html` para Vite + TypeScript, dividindo em módulos (`data/`, `ui/`, `sync/`) — isso sozinho não muda nenhum comportamento, só prepara o terreno.
2. Criar projeto Supabase (região São Paulo), modelar as tabelas espelhando o `S` atual (`places`, `patients`, `appts`, `insurers`, `exceptions`, `profile`), com RLS por `user_id`.
3. Implementar Auth (cadastro/login por e-mail) substituindo o onboarding atual por "criar conta" — mantendo a opção de continuar só local para quem não quiser nuvem (feature flag).
4. Implementar a fila de sincronização: toda escrita local grava local primeiro (igual hoje) e marca para sync; um serviço em background sobe/baixa alterações quando há conexão.
5. Migração do `localStorage` existente para a conta na primeira vez que a usuária loga.
6. Testes de regressão rodando offline e online (cenário avião, cenário com 2 dispositivos).
7. Texto de consentimento no onboarding + página de exclusão de conta + exportação completa (local + nuvem).

## 6. Pendências para validar com jurídico antes de implementar

- Prazo mínimo de guarda de prontuário (normas do CFM) vs. direito de exclusão da LGPD — definir política de retenção antes de construir o botão "excluir conta".
- Texto exato do consentimento para armazenamento em nuvem de dados de saúde.

---

Fontes consultadas para preços e LGPD (verificar antes de decidir, pois blogs de terceiros divergem em detalhes e preços mudam):
- [Supabase Pricing: 2026 Guide to Plans, Limits, and Real-World Costs](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)
- [Supabase Pricing in 2026: What You'll Actually Pay](https://makerkit.dev/blog/md/saas/supabase-pricing)
- [LGPD em hospitais e clínicas: prontuário e telemedicina](https://confidata.com.br/blog/lgpd-hospitais-clinicas-prontuario-telemedicina)
- [LGPD para clínicas médicas: guia de adequação](https://confidata.com.br/blog/lgpd-clinicas-medicas-guia-adequacao-2026)
- [Paciente no comando: LGPD e dados sensíveis de saúde (Serpro)](https://serpro.gov.br/lgpd/noticias/2019/paciente-no-comando-lgpd-dados-sensiveis-saude)
