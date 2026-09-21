# Testes — estratégia, comandos e cobertura

Este documento descreve **o que existe de fato** nos dois repositórios (backend Strapi e frontend TanStack Start):
os tipos de teste, como rodar, quais cenários cobrem, como os dados de teste são isolados e — de forma
explícita — **quanto de cobertura medimos versus a meta**, incluindo o que ainda não está coberto e por quê.

- Backend: `Área de trabalho/backend` (este repositório)
- Frontend: `Área de trabalho/front-pitango/pitang-boost-pathways`

> Nenhum segredo é documentado aqui. Credenciais e URLs de banco vivem em `.env.test` (ignorado pelo git).

---

## 1. Tipos de teste e ferramentas

Tudo abaixo foi instalado especificamente para esta entrega — antes dela **não existia nenhum framework de teste** em nenhum dos dois repositórios.

| Tipo | Onde | Ferramenta | O que valida | Toca banco/rede? |
|---|---|---|---|---|
| **Unitário (backend)** | `tests/unit/` | Vitest 4 + `strapi.db` falso em memória (`tests/helpers/fake-strapi.ts`) | Regras de negócio isoladas: progresso, dependências, desbloqueio, seleção de tarefas, policies de autorização, camada de IA/MCP | Não |
| **Integração / API (backend)** | `tests/integration/` | Vitest 4 + Supertest + **Strapi real** + Postgres real | Rotas HTTP de ponta a ponta: status, payload, validações, autenticação, autorização, erros esperados | Banco (schema isolado) |
| **Unitário / componente (frontend)** | `src/**/*.test.ts(x)` | Vitest 4 + React Testing Library + jest-dom + user-event | Lógica pura, serviços (axios mockado), contexto de auth, guarda de rota, componente de revisão da IA | Não |
| **E2E (frontend + backend)** | `e2e/*.spec.ts` (frontend) | Playwright (Chromium) | Jornadas reais no navegador contra backend + frontend isolados | Banco (schema isolado) |

Não há Jest, Cypress nem Testing Library "antigos" no projeto: **Vitest** é o único runner unitário/integração e **Playwright** o único E2E.

---

## 2. Como rodar

### Pré-requisitos

1. `npm install` nos dois repositórios.
2. Backend: um arquivo `.env.test` (ignorado pelo git) com a conexão Postgres e **`DATABASE_SCHEMA=pitang_test`** (schema isolado — ver §3), `PORT=1338`, `LOG_LEVEL=error` e as chaves de app do Strapi (`APP_KEYS`, `JWT_SECRET`, …). O `.env.example` lista os nomes.
3. Frontend: `.env.test` com `VITE_API_URL=http://localhost:1338`.
4. Playwright, uma vez: `npx playwright install chromium` (dependências de sistema, se faltarem, exigem `sudo`).

### Comandos (todos reais, extraídos dos `package.json`)

**Backend** (`Área de trabalho/backend`)

| Comando | O que faz |
|---|---|
| `npm test` | Unitários **e** integração (unit roda primeiro) |
| `npm run test:unit` | Só unitários — segundos, sem Strapi e sem banco |
| `npm run test:integration` | Só integração — sobe o Strapi uma vez (~20–30 s) |
| `npm run test:coverage` | Tudo + relatório de cobertura (`coverage/`: texto, HTML, lcov, json-summary) |
| `npm run test:watch` | Modo watch |
| `npm run develop:test` | Sobe o Strapi de teste (porta 1338, schema `pitang_test`) — usado pelo Playwright |

**Frontend** (`Área de trabalho/front-pitango/pitang-boost-pathways`)

| Comando | O que faz |
|---|---|
| `npm test` | Unitários/componente |
| `npm run test:coverage` | Idem + cobertura (`coverage/`) |
| `npm run test:e2e` | Playwright completo (sobe backend de teste **e** frontend de teste sozinho) |
| `npm run test:e2e:ui` | Playwright com a UI interativa |
| `npm run dev:test` | Frontend de teste (porta **5180**, aponta para o backend 1338) |
| `npm run lint` · `npx tsc --noEmit` | Lint e checagem de tipos |

O Playwright (`playwright.config.ts`) inicia dois processos por conta própria — backend (`develop:test`, health-check em `/_health`) e frontend (`dev:test`, health-check em `/login`) — e reaproveita servidores já de pé fora do CI. A suíte E2E completa leva ~7 min por causa do boot do Strapi em modo dev e do recálculo de snapshots de trilha.

---

## 3. Estratégia de dados de teste

Requisitos: testes **reprodutíveis, independentes, determinísticos e re-executáveis**, **sem depender da massa de demonstração** e **sem nunca destruí-la**.

- **Schema isolado.** Backend e E2E usam o schema Postgres **`pitang_test`** (mesmo servidor, schema separado do de dev/demo). O harness recusa subir se `DATABASE_SCHEMA !== 'pitang_test'` (`tests/setup/strapi-instance.ts`), e o `global-setup` do Playwright faz a mesma checagem antes de qualquer `TRUNCATE`. O schema é criado automaticamente na primeira execução.
- **Portas isoladas.** Backend de teste na **1338**, frontend de teste na **5180** — não colidem com as portas de desenvolvimento.
- **Um Strapi para toda a suíte de integração.** O boot é caro; `isolate: false` + `fileParallelism: false` compartilham uma única instância entre os arquivos de teste. Por isso os arquivos **não podem depender de ordem**: cada um cria seus próprios dados.
- **Factories, sem IDs fixos.** `tests/helpers/factories.ts` cria trilhas, tarefas, usuários e atribuições com sufixo único (`uniqueSuffix()`); os testes usam os IDs devolvidos, nunca literais. As factories replicam o comportamento real (ex.: cada tarefa criada gera um novo snapshot da trilha).
- **Usuários seed.** Os quatro perfis (`admin`, `hr`, `leadership`, `employee`) vêm do bootstrap de permissões (`seedUsersPermissions`), que roda no boot de teste e é idempotente.
- **E2E: limpeza entre execuções.** `e2e/global-setup.ts` faz `TRUNCATE … RESTART IDENTITY CASCADE` das tabelas de negócio do schema de teste (`tasks`, `tracks`, `track_assignments`, `task_executions`, `task_evidences`, `track_versions`, `projects`, `audit_logs`, `ai_suggestions`) antes de cada execução. Sem isso, listas acumulavam dados, buscas por texto pegavam registros de execuções antigas e a suíte ficava lenta. **Usuários e papéis não são apagados.** Nomes de entidades criadas nos E2E levam um `RUN_ID` único.
- **IA nunca é real nos testes.** O harness de backend força `AI_PROVIDER=mock`, `ANTHROPIC_API_KEY=''`, `AI_TIMEOUT_MS=1500` e `MCP_TRANSPORT=local` **depois** de carregar o `.env.test` — um `.env` com chave real não vaza para a suíte.

### Acoplamento conhecido entre suítes

A integração do backend e o E2E **compartilham o schema `pitang_test`**. A integração cria usuários `test.<perfil>.*` que o `global-setup` do E2E não remove. Consequência real já observada: seletores E2E amplos (`/Employee/i`) passaram a casar com esses usuários. **Regra:** E2E seleciona o usuário seed por nome exato (`employee.pitango`). Se isso voltar a incomodar, a saída é um schema por suíte.

---

## 4. Cenários cobertos

### 4.1 Backend — unitários (`tests/unit/`, 6 arquivos de regras + 4 da IA)

| Arquivo | Cenários principais |
|---|---|
| `progress.test.ts` | Sem execuções → 0%/`not_started`; só locked/available; `in_progress` e `started_at` preservado; arredondamento (1/3 → 33,33); `submitted` **não** conta como concluída; 100% → `completed` + `completed_at`; isola por atribuição; atribuição inexistente → `TRACK_ASSIGNMENT_PROGRESS_NOT_FOUND` |
| `dependency-release.test.ts` | Libera quando a dependência conclui; `submitted` ainda bloqueia; várias dependências exigem **todas**; sem dependências nunca libera; dependência inexistente mantém bloqueio; não regride `in_progress`; ignora snapshot nulo; não mistura atribuições |
| `task-dependency.test.ts` | Códigos `TASK_TRACK_REQUIRED_FOR_DEPENDENCIES`, `TASK_ORDER_REQUIRED_FOR_DEPENDENCIES`, `TASK_DEPENDENCY_NOT_FOUND`, `TASK_DEPENDS_ON_ITSELF`, `TASK_DEPENDENCY_TRACK_MISMATCH`, `TASK_DEPENDENCY_ORDER_INVALID` (igual e anterior); formas `set`/`connect`/documentId; herança de trilha/ordem na atualização |
| `task-selection.test.ts` | Ordenação por `order_index`; exclui `is_active=false`; filtra por trilha; deduplica por `documentId` preferindo a versão publicada |
| `has-role.test.ts` / `is-active-user.test.ts` | `AUTH_REQUIRED`, perfil permitido (por `type` e por `name`), `USER_ROLE_FORBIDDEN` (+ log), `USER_ROLE_NOT_FOUND`, falha de banco → `POLICY_*_LOOKUP_FAILED`, `USER_BLOCKED`, `USER_INACTIVE`, campo `is_active` ausente ≠ inativo |
| `ai-*.test.ts`, `mcp-service.test.ts`, `suggestion-generation.test.ts` | Ver [`ai-mcp.md`](./ai-mcp.md) §9 |

### 4.2 Backend — integração/API (`tests/integration/`, 8 arquivos)

Cobrem os grupos de endpoints exigidos: **Auth, Users, Projects/Tracks, Tasks, Assignments, Task executions, Evidences, Approvals** (+ AI suggestions). "Phases" não existe como entidade — ver §7.

| Arquivo | Cenários |
|---|---|
| `auth.test.ts` | Login válido (JWT + usuário); inválido → 400; rota protegida sem token → 401/403; com token → 200; `/api/me` devolve a role |
| `authorization.test.ts` | employee **não** cria trilha/tarefa, não lista usuários, não aprova (403); admin cria trilha (201); leadership lista usuários; hr passa na policy de revisão |
| `tracks-and-tasks.test.ts` | Trilha nasce na versão 1 com snapshot legível; criar tarefa incrementa a versão; dependência de ordem igual/posterior, de outra trilha e de si mesma rejeitadas |
| `assignments-and-progress.test.ts` | Execuções nascem `available`/`locked` conforme dependência; concluir libera a próxima e atualiza progresso; concluir tudo → `completed`/100%; concluir tarefa bloqueada → `TASK_EXECUTION_NOT_AVAILABLE` |
| `evidence.test.ts` | Sem evidência → `TASK_EVIDENCE_REQUIRED`; evidência por link permite concluir; URL inválida → `TASK_EVIDENCE_URL_REQUIRED`; remover evidência bloqueia de novo |
| `approval.test.ts` | Aprovação manual deixa `submitted` (progresso 0%); rejeição sem feedback → 400; ciclo enviar → rejeitar → reenviar → aprovar; aprovar libera dependentes |
| `ai-suggestion.test.ts` | Geração pendente sem criar trilha/tarefa; contexto MCP no banco real (duplicidade); validação do objetivo; 5 falhas de IA (erro, vazio, não-JSON, dependência inválida, timeout) sem persistir nada e sem vazar causa interna; 403 para colaborador; sem PUT/DELETE genérico |
| `ai-suggestion-review.test.ts` | Aprovar (sem/ com edição), trilha real com versão 1/dependências/snapshot/auditoria, trilha atribuível, edição inválida → 400, dupla aprovação, **3 aprovações concorrentes → 1 vence**, rollback transacional, rejeitar com/sem motivo, estados finais imutáveis, 403/404 |

### 4.3 Frontend — unitários/componente

| Arquivo | Cenários |
|---|---|
| `auth-context.test.tsx` | Hidratação sem sessão, sessão válida (revalida no backend), token expirado, JSON corrompido, login (ok/falha), logout, `hasRole` |
| `auth.service.test.ts` | Mapeamento de perfil (**desconhecido → `employee`**, menor privilégio), `active` a partir de `blocked`, fluxo login + `/api/me` |
| `AuthenticatedLayout.test.tsx` | Loader durante hidratação, sem usuário → `/login`, perfil fora da rota → `/dashboard`, perfil permitido renderiza |
| `StatusBadge.test.tsx` | Rótulo pt-BR de todos os status e perfis (inclui `pending_review`, `edited`) |
| `api-error.test.ts` | Toda ramificação de `getApiErrorMessage` (rede, código, mensagem crua, 403/5xx, não-Axios) |
| `tracks.service.test.ts` | Ordenação de materiais, mapeamento de `dependsOn`, materiais vazios |
| `ai-suggestion.test.ts` | `removeTask` (reindexação de dependências), igualdade estrutural, `validateDraft` |
| `ai-suggestions.service.test.ts` | Payloads/rotas de gerar, listar, aprovar (com/sem edição) e rejeitar; mapeamento de campos ausentes |
| `SuggestionReview.test.tsx` | Proposta pendente e avisos, aprovar sem editar (**não** envia `finalResult`), edição, remoção de tarefa, validação local, rejeição exige motivo, estado ocupado, modo somente leitura por status |

### 4.4 E2E (Playwright, 28 testes)

| Arquivo | Cobre |
|---|---|
| `happy-path.spec.ts` | Jornada completa (ver mapeamento abaixo) |
| `auth.spec.ts` | Login válido/inválido, rota protegida sem sessão, sessão após refresh |
| `permissions.spec.ts` | Colaborador barrado de áreas de gestão; liderança barrada de "Minhas Trilhas"; navegação sem links indevidos |
| `evidence-and-approval.spec.ts` | Não conclui sem evidência; enviar → **rejeitar com motivo** → colaborador vê o feedback → reenviar → aprovar |
| `ai-suggestions.spec.ts` | Gerar (pendente **não** cria trilha) → editar + aprovar (trilha existe com as edições) → somente leitura → rejeitar → falha da IA → objetivo curto → acesso de colaborador |
| `smoke.spec.ts` | Login com usuário seed |

**Mapeamento do Happy Path (36 passos do pedido).** "Fases" não é uma entidade do sistema (é só um rótulo de texto herdado do seed de demonstração); por decisão do produto foi tratada como **conceitual**, então os passos 4, 15 e 35 (criar/ver/concluir fases) não têm passo dedicado. Os demais 33 estão em `happy-path.spec.ts` (5 testes seriais): gestão cria projeto, trilha e 4 tarefas (comum, com material, dependente, com evidência + aprovação) e atribui; colaborador abre "Minhas Trilhas", vê a dependência **bloqueada**, acessa o material, conclui a tarefa simples, vê o desbloqueio, anexa evidência por link e envia para aprovação ("Aguardando aprovação"); liderança vê a evidência e aprova; colaborador vê a tarefa aprovada, o progresso atualizado, conclui o restante e confirma a trilha 100% concluída. O teste usa `describe.serial` de propósito: é **uma** jornada de negócio, não testes independentes.

Seletores: `getByRole`, `getByLabel`, `getByTestId` (`track-card`, `task-card`, `approval-row`, `suggestion-row`, `suggestion-task`); sem `waitForTimeout` e sem depender de classes CSS.

---

## 5. Cobertura: meta × medido

**Meta:** ≥ 80% nas regras críticas. **Não escrevemos testes artificiais para inflar percentual** — onde a meta não é atingida, isso está declarado na §5.3.

### 5.1 Números atuais (`npm run test:coverage`)

| | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| **Backend** (175 testes) | 33,5% | 30,8% | 37,5% | 33,5% |
| **Frontend** (88 testes) | 41,7% | 35,1% | 34,6% | 42,5% |

Os totais são **baixos por construção**, não por falta de teste: o frontend exclui `src/routes/**` e `src/components/ui/**` da cobertura (páginas são cobertas pelo E2E; `ui/` é shadcn de terceiros) e o backend tem a limitação de instrumentação da §5.2.

### 5.2 Limitação de instrumentação do backend (causa raiz, não corrigida de propósito)

O `@vitest/coverage-v8` só enxerga código que passa pelo **pipeline de transform do Vitest**. Nos testes de integração o Strapi é iniciado por `require('@strapi/strapi')` e carrega **seu próprio `dist/*.js` compilado** — esse código executa (e os testes de integração o exercitam de verdade), mas é **invisível** ao v8.

Como verificamos que é isso: (1) `"sourceMap": true` no `tsconfig` não mudou nenhum número; (2) o único arquivo de serviço com cobertura via integração, `track-versioning.ts`, é também importado diretamente por `tests/helpers/factories.ts` — ou seja, só o que passa pelo Vitest aparece. Forçar toda a árvore do `@strapi/strapi` pelo transform do Vite (`server.deps.inline`) foi descartado: já quebrou o boot (`lodash/fp`) e o risco supera o ganho.

**Contorno adotado:** extrair regras críticas em módulos testáveis por unidade (com `strapi.db` falso), que passam pelo Vitest e **medem de verdade** (§5.3), e demonstrar o restante pela matriz regra → teste.

### 5.3 Matriz regra crítica → teste

**Legenda:** **Medido** = percentual do v8 (Stmts/Branch). **Funcional** = exercitado por teste real, mas sem percentual (limitação da §5.2).

| Regra crítica | Onde vive | Cobertura | Testes que a provam |
|---|---|---|---|
| Cálculo de progresso e conclusão da trilha | `task-execution/services/progress.ts` | **Medido 100% / 100%** | `progress.test.ts`; integração `assignments-and-progress` |
| Validação de dependência entre tarefas | `task/services/task-dependency.ts` | **Medido 100% / 100%** | `task-dependency.test.ts`; integração `tracks-and-tasks` |
| Liberação de tarefas dependentes | `task-execution/services/dependency-release.ts` | **Medido 100% / 90%** | `dependency-release.test.ts`; integração `assignments-and-progress`, `approval` |
| Seleção/ordenação de tarefas | `task-execution/services/task-selection.ts` | **Medido 100% / 85,7%** | `task-selection.test.ts` |
| Autorização por perfil e usuário ativo | `policies/has-role.ts`, `is-active-user.ts` | **Medido 100% / 100%** | `has-role.test.ts`, `is-active-user.test.ts`; integração `authorization`; E2E `permissions` |
| Sessão no frontend (hidratação, login, logout, role) | `auth-context.tsx`, `auth.service.ts` | **Medido 100% / 100%** | `auth-context.test.tsx`, `auth.service.test.ts`; E2E `auth` |
| Guarda de rota por perfil (UI) | `AuthenticatedLayout.tsx` | **Medido 78% / 94%** | `AuthenticatedLayout.test.tsx`; E2E `permissions` |
| Camada de IA (validador, serviço, MCP, orquestração, provedores) | `ai-suggestion/services/*` | **Medido 86–100%** (branches 74–100%) | 4 arquivos: `ai-result-validator`, `ai-service`, `mcp-service`, `suggestion-generation` |
| Revisão humana no frontend | `SuggestionReview.tsx`, `ai-suggestion.ts`, `ai-suggestions.service.ts` | **Medido 86% / 96%**, 97% / 95%, 100% / 85% | testes do §4.3; E2E `ai-suggestions` |
| Autenticação (login/JWT/`/me`) | plugin users-permissions + `me.ts` | Funcional | integração `auth`; E2E `auth` |
| Versionamento imutável de trilha | `track/services/track-versioning.ts` | **Medido 65% / 33%** | integração `tracks-and-tasks`; **abaixo da meta** (§5.4) |
| Atribuição de trilha e criação das execuções | `track-assignment` (serviço + controller) | Funcional | integração `assignments-and-progress`; E2E `happy-path` |
| Evidência obrigatória (anexar/remover/exigir) | `task-execution` (controller + serviço) | Funcional | integração `evidence`; E2E `evidence-and-approval` |
| Aprovação manual, rejeição com feedback, reenvio | `task-execution` (controller + serviço) | Funcional | integração `approval`; E2E `happy-path`, `evidence-and-approval` |
| Criação/aprovação/rejeição de sugestões (controller) | `ai-suggestion/controllers` | Funcional | integração `ai-suggestion*` (36 testes); E2E `ai-suggestions` |
| Fluxo completo do colaborador | UI + API | Funcional (E2E) | `happy-path.spec.ts` |

### 5.4 Onde a meta de 80% **não** foi atingida

| Regra | Cobertura atual | Motivo | Teste que falta |
|---|---|---|---|
| Conclusão, evidência, aprovação e rejeição de tarefa (`task-execution` service ~670 linhas + controller ~400) | **0% medido** (funcional: 12 testes de integração + E2E) | Código carregado pelo `require()` do Strapi (§5.2); além disso o serviço usa muito mais do `strapi.db` do que o fake atual suporta | Testes unitários do serviço com o fake estendido (`create`/`delete`/`populate`/transação) |
| Atribuição de trilha (`track-assignment` service ~90 linhas + controller ~200) | **0% medido** (funcional) | Idem | Idem — unit de `assignTrackToUser` (criação de execuções `available`/`locked`) |
| `track-versioning.ts` | **65% / 33% branches** | Só as funções chamadas pelas factories passam pelo Vitest | Unit de `buildTrackSnapshot`/`persistSnapshot` com fixtures |
| Controllers de `task`, `track`, `me`, `ai-suggestion` | **0% medido** (funcional) | §5.2 | Extrair a lógica dos controllers para serviços testáveis, se a meta numérica for exigida |
| `utils/logger.ts` | 57% / 17% | Ramos de erro/escopo de requisição só ocorrem dentro do Strapi | Unit direto de `serializeError`/`logError` |

Em resumo: **as regras extraídas em módulos puros estão ≥ 85%; as regras que vivem em controllers/serviços grandes do Strapi estão comprovadas por testes reais de integração e E2E, mas sem percentual.** Chegar aos 80% *medidos* nelas exige o trabalho de extração/unit da tabela acima — não é um problema de "faltar cenário".

---

## 6. CI

Antes desta entrega o backend tinha apenas um workflow de **build** (`.github/workflows/build.yml`) e o frontend **nenhum**.

| Repositório | Workflow | Etapas | Status |
|---|---|---|---|
| Backend | `build.yml` | install (`--frozen-lockfile`) → **testes unitários** → build | unitários adicionados |
| Frontend | `ci.yml` (novo) | `npm ci` → lint → `tsc --noEmit` → **testes unitários** → build | criado |

**O que NÃO roda no CI (e o que falta para rodar):**

| Suíte | Por que não está no CI | O que falta |
|---|---|---|
| Integração do backend | Precisa de um Postgres e de todas as variáveis de app do Strapi | Um `services: postgres` no workflow, um `.env.test` gerado com valores descartáveis (`APP_KEYS`, `JWT_SECRET`, …, `DATABASE_SCHEMA=pitang_test`) e o `dotenv` carregando-o |
| E2E (Playwright, 28 testes) | Precisa de backend + frontend + Postgres + Chromium, e leva ~7 min | Tudo o acima **mais** `npx playwright install --with-deps chromium`, e o `BACKEND_DIR` do `playwright.config.ts` hoje é um caminho absoluto da máquina local — precisaria virar configurável, além de o backend estar num repositório separado (checkout dos dois no mesmo job) |
| Cobertura | Sem meta imposta no CI | Publicar o `coverage/lcov` e, se desejado, um *threshold* (só faz sentido depois de a §5.4 ser tratada) |

**Estes workflows não foram executados no GitHub Actions** — foram validados reproduzindo os mesmos comandos num clone limpo da máquina local (ver `release-checklist.md`). A primeira execução real acontece no primeiro push.

---

## 7. Lacunas e decisões conhecidas

- **"Fases" não existem** como entidade (ver §4.4). Se virarem uma entidade, o Happy Path ganha os passos 4, 15 e 35.
- **Provedor de IA real não foi exercitado** (sem chave no ambiente): testado só com cliente injetado. Ver `ai-mcp.md` §11.
- **Sem testes de carga, de acessibilidade automatizada (axe) ou de regressão visual.** As correções de acessibilidade feitas (labels com `htmlFor`) são verificadas indiretamente porque os E2E localizam campos por `getByLabel`.
- **Somente Chromium** no Playwright.
- **Erros de rede no frontend** (timeout/offline) só são cobertos no nível unitário (`api-error.test.ts`), não em E2E.

---

## 8. Armadilhas conhecidas (para quem for escrever novos testes)

- **Hidratação do React:** em E2E, após `page.goto()` de uma tela com formulário, aguarde `waitForLoadState('networkidle')` antes de interagir — senão o clique cai no submit nativo do navegador.
- **Não use `vite dev --mode test`:** quebra o SSR do TanStack Start. As variáveis de teste entram via `dotenv-cli` (`dev:test`).
- **Seletores por texto em cards:** o mesmo texto aparece em vários `div` aninhados. Use `data-testid` na raiz do card e filtre por texto a partir dele. Um título de tarefa também pode aparecer em "Depende de: …" — use `exact: true` ou `getByRole('heading')`.
- **Diálogos empilhados:** o diálogo de revisão de aprovações permanece montado atrás do de rejeição; ambos têm um botão "Rejeitar" — escope ou use `.last()`.
- **Boot do Strapi (Vitest):** use `require('@strapi/strapi')` (não `import()`); arquivos `.ts` locais carregam-se por `import()` dinâmico; e o boot precisa chamar `server.mount()` explicitamente (sem `.listen()` as rotas dão 404).
- **Vitest 4:** `poolOptions` foi removido — usar `pool`/`fileParallelism`/`isolate` no nível do projeto.
- **Mensagens do `dotenv`:** o pacote imprime "tips" promocionais no console. São inofensivas (estão no código do `dotenv`), não são erro.
