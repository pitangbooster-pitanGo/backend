# Arquitetura — Pitang Booster

Documento de revisão arquitetural para apresentação final. Cobre os dois repositórios do sistema, com a stack, as camadas, o modelo de dados, os fluxos principais e as decisões técnicas tomadas — inclusive as que ficaram em aberto.

- Backend: `Área de trabalho/backend` (este repositório) — Strapi 5, TypeScript, Postgres.
- Frontend: `Área de trabalho/front-pitango/pitang-boost-pathways` — TanStack Start, React 19, TypeScript.

Documentos relacionados: [`testing.md`](./testing.md) (estratégia de testes e cobertura), [`ai-mcp.md`](./ai-mcp.md) (arquitetura de IA/MCP em detalhe), [`release-checklist.md`](./release-checklist.md) (estado da entrega).

---

## 1. O que o sistema faz

O Pitang Booster organiza o onboarding e o desenvolvimento de colaboradores em **trilhas**: sequências de **tarefas** com dependências entre si, que uma pessoa gestora monta e atribui a um colaborador. O colaborador executa as tarefas liberadas, anexa evidência quando exigido, e algumas tarefas passam por **aprovação manual** de alguém da liderança antes de contarem como concluídas. O sistema calcula o progresso da trilha automaticamente. Um módulo de **IA** ajuda a esboçar a estrutura de uma trilha a partir de um objetivo em texto livre, mas nunca cria nada sozinho — sempre depende de aprovação humana.

Quatro perfis: `admin`, `hr`, `leadership` (gestão — criam trilhas, atribuem, aprovam) e `employee` (colaborador — executa).

---

## 2. Arquitetura de alto nível

```
┌─────────────────────────────┐        ┌──────────────────────────────────────┐
│  Frontend (TanStack Start)  │  HTTP  │  Backend (Strapi 5 / Node)            │
│  React 19 + React Query     │ ─────► │  routes → policies → controllers      │
│  axios (apiClient)          │  JSON  │        → services → strapi.db (ORM)   │
└─────────────────────────────┘        │                                       │
                                        │  ┌─ AIService ─┐  ┌─ MCPService ─┐    │
                                        │  │ mock/       │  │ list_        │    │
                                        │  │ anthropic/  │  │ existing_    │    │
                                        │  │ gemini      │  │ tracks       │    │
                                        │  └─────────────┘  └──────────────┘    │
                                        └──────────────────┬────────────────────┘
                                                            │
                                                     ┌──────▼───────┐
                                                     │  PostgreSQL   │
                                                     │  (Supabase)   │
                                                     └───────────────┘
```

- O frontend nunca fala com o banco nem com provedores de IA diretamente — só com a API do Strapi. Não há chave de IA nem lógica de negócio sensível no navegador.
- O backend é o único dono das regras de negócio: dependência entre tarefas, cálculo de progresso, aprovação, versionamento de trilha e a fronteira de validação da IA.
- O banco é um Postgres gerenciado (Supabase em desenvolvimento/teste; produção configurada via `DATABASE_URL` — ver `README.md` § Deploy).

---

## 3. Stack tecnológica

### Backend
| Camada | Tecnologia | Versão |
|---|---|---|
| Framework | Strapi (Community Edition) | 5.40.0 |
| Linguagem | TypeScript | ^5 |
| Runtime | Node.js | ≥20, ≤24.x |
| Banco | PostgreSQL | via `pg` |
| Testes | Vitest 4 + Supertest | — |
| IA (SDK oficial) | `@anthropic-ai/sdk` | ^0.127.0 |
| IA (REST direto) | Gemini via `fetch` (sem SDK) | — |

### Frontend
| Camada | Tecnologia | Versão |
|---|---|---|
| Framework | TanStack Start (SSR) | ^1.167 |
| UI | React | ^19.2 |
| Roteamento | TanStack Router (file-based) | ^1.168 |
| Estado servidor | TanStack Query | ^5.83 |
| Build | Vite | ^7.3 |
| Estilo | Tailwind CSS v4 + shadcn/ui | — |
| HTTP | axios | ^1.18 |
| Validação | zod | ^3.24 |
| Testes | Vitest 4 + React Testing Library + Playwright | — |
| Wrapper de config | `@lovable.dev/vite-tanstack-config` | ^2.3 |

Não há um framework de estado global do lado do cliente (Redux/Zustand): o cache do TanStack Query cumpre esse papel para dados de servidor, e o `AuthProvider` (Context API) cobre a sessão.

---

## 4. Backend — organização em camadas

Strapi organiza cada domínio (`api::<nome>`) em `content-types/` (schema), `routes/`, `policies` (globais, em `src/policies/`), `controllers/` e `services/`. O fluxo de uma requisição é:

```
rota → policies (auth) → controller (orquestra, valida entrada, chama services) → service (regra de negócio) → strapi.db (query builder)
```

Módulos por domínio (`src/api/`): `project`, `track`, `track-version`, `task`, `track-assignment`, `task-execution`, `task-evidence`, `audit-log`, `ai-suggestion`, `me` (perfil do usuário autenticado).

**Padrão consistente entre módulos**: controllers usam `factories.createCoreController` do Strapi e sobrescrevem só as ações que precisam de regra extra (a maioria expõe `find`/`findOne` puros e customiza `create`/`update`/ações próprias). Regras de negócio complexas (validação de dependência, versionamento, progresso) vivem em `services/`, nunca no controller — são as unidades testadas isoladamente em `tests/unit/` (ver `testing.md` §5.3).

**Rotas customizadas** (além do CRUD REST gerado pelo Strapi):
```
GET  /me                                                    — perfil + role do usuário autenticado
GET  /tracks/:documentId/details                            — snapshot da versão atual da trilha
GET  /my-track-assignments                                  — trilhas do colaborador logado
GET  /my-track-assignments/:id/tasks                        — tarefas + execuções da atribuição
POST /task-executions/:id/complete                          — concluir/submeter uma tarefa
POST /task-executions/:id/approve | /reject                 — revisão manual (gestão)
POST /my-task-executions/:id/evidences                      — anexar evidência
DELETE /my-task-executions/:id/evidences/:evidenceId        — remover evidência
POST /ai-suggestions                                        — gerar sugestão de trilha (IA)
POST /ai-suggestions/:id/approve | /reject                  — revisão humana da sugestão
```

**Policies globais** (`src/policies/`, reaproveitadas em quase toda rota):
- `global::is-active-user` — bloqueia usuário sem sessão, bloqueado ou inativo.
- `global::has-role` — restringe por perfil (`config: { roles: [...] }`), usada nas rotas de gestão/aprovação/IA.

**Middlewares** (`config/middlewares.ts`): `global::request-logger` substitui o logger padrão do Strapi por um que grava `requestId` + usuário em cada linha (correlacionável com o `x-request-id` que o frontend envia); CORS expõe explicitamente esse header.

**Bootstrap** (`src/index.ts`, roda uma vez ao subir): `seedUsersPermissions` (cria/atualiza os 4 perfis e usuários de demonstração, idempotente), `backfillTrackVersions` (migração de trilhas antigas sem snapshot), `protectHistoricalMaterialFiles` (impede apagar um arquivo de material que uma versão antiga da trilha ainda referencia).

---

## 5. Modelo de dados

```
User (plugin users-permissions)
 │  role: admin | hr | leadership | employee   is_active: boolean
 │
 ├─< Track (created_by_user)                    Project ─┐
 │    name, track_type, version (int, imutável↑) │        │ manyToMany
 │    │                                          └────────┘
 │    ├─< Task (track)
 │    │    order_index, action_type, requires_evidence,
 │    │    requires_manual_approval, is_active
 │    │    ├─< depends_on (manyToMany Task→Task, mesma trilha)
 │    │    └─< materials (component, repetível: title/type/order/url|file)
 │    │
 │    └─< TrackVersion (track, version)          — snapshot IMUTÁVEL
 │         content: { name, tasks: [ {título, tipo, dependsOn, materials...} ] }
 │
 ├─< TrackAssignment (track, user, assigned_by)
 │    status, progress_percentage, track_version, track_snapshot (cópia)
 │    │
 │    └─< TaskExecution (track_assignment, task)
 │         task_source_document_id, task_snapshot (cópia da tarefa no momento)
 │         execution_status: locked|available|in_progress|submitted|
 │                            approved|rejected|completed
 │         validated_by, validation_status, review_feedback
 │         │
 │         └─< TaskEvidence (task_execution, submitted_by)
 │              evidence_type: file | link
 │
 ├─< AiSuggestion (created_by_user, reviewed_by_user, track?)
 │    status: pending_review → approved | edited | rejected
 │    original_result (json, imutável) / final_result (json, se aprovada)
 │
 └─< AuditLog (actor)
      entity_type: task | track | track-assignment · action: create|update|delete
      changes: json (diff campo a campo)
```

Pontos que não são óbvios de fora:

- **`Track.version` é um contador simples; `TrackVersion` é o snapshot imutável de cada versão.** Toda mudança estrutural (criar/editar/remover tarefa, mexer em dependência ou material) incrementa `version` e grava um novo `TrackVersion.content` — o snapshot anterior nunca é sobrescrito.
- **`TrackAssignment` e `TaskExecution` carregam sua PRÓPRIA cópia congelada** (`track_snapshot` / `task_snapshot`) da trilha/tarefa no momento da atribuição. Se a trilha for editada depois, quem já está executando continua vendo a versão que lhe foi atribuída — só novas atribuições pegam a versão atual.
- **`depends_on` é uma relação tarefa→tarefa dentro da mesma trilha**, validada para exigir `order_index` estritamente menor (nunca a própria tarefa, nunca de outra trilha, nunca uma posterior).
- **`AiSuggestion.track` só é preenchido na aprovação** — antes disso é `null`, porque nada foi criado.

---

## 6. Fluxos principais

### 6.1 Autenticação e autorização
Login via plugin `users-permissions` do Strapi (`POST /api/auth/local` → JWT) seguido de `GET /api/me` para obter o perfil com a `role`. O frontend guarda `{ user, token }` no `localStorage` e reidrata validando o token contra `/api/me` a cada carregamento (token inválido/expirado é descartado silenciosamente, sem travar a aplicação). Toda rota sensível do backend passa por `is-active-user` + `has-role`; no frontend, `AuthenticatedLayout` redireciona por perfil antes mesmo da chamada à API (defesa em profundidade, não substitui a policy do backend).

### 6.2 Criar e versionar uma trilha
`POST /api/tracks` cria a trilha (`version = 1`) e grava o primeiro `TrackVersion`. Cada `POST/PUT /api/tasks` subsequente (criação, edição, dependência, material) roda `createNextTrackSnapshot`: incrementa `version` sob um `SELECT ... FOR UPDATE` (serializa edições concorrentes na mesma trilha) e persiste um novo `TrackVersion.content` com a estrutura completa. `GET /tracks/:id/details` sempre lê o snapshot da versão atual, nunca reconstrói a partir das tabelas relacionais ao vivo.

### 6.3 Atribuir e executar
`track-assignment.assignTrackToUser` copia o snapshot atual da trilha para a atribuição e cria uma `TaskExecution` por tarefa, cada uma com seu próprio `task_snapshot`. O status inicial de cada execução vem de `getTaskExecutionState`: **`available`** se não tem dependência (ou a única dependência já foi satisfeita por outra trilha — não aplicável aqui, é por atribuição) e **`locked`** caso contrário. Ao completar uma execução, `dependency-release.ts` varre as execuções `locked` da mesma atribuição e libera as que dependiam só de tarefas já `completed`.

### 6.4 Evidência e aprovação manual
Uma tarefa com `requires_evidence=true` não pode ser concluída sem ao menos uma `TaskEvidence` anexada (`TASK_EVIDENCE_REQUIRED`). Uma tarefa com `requires_manual_approval=true` não vai direto para `completed` ao ser "concluída" pelo colaborador — fica `submitted`, e uma pessoa de gestão decide via `POST /approve` (→ `completed`, libera dependentes) ou `POST /reject` (exige `review_feedback`, volta o colaborador ao fluxo para reenviar).

### 6.5 Progresso
`syncTrackAssignmentProgress` roda depois de qualquer conclusão/aprovação: `progress = completed / total * 100` (2 casas), `status = completed` se `completed === total`, `in_progress` se alguma execução saiu de `locked`/`available`, senão `not_started`. `submitted` (aguardando aprovação) **não** conta como concluída.

### 6.6 Auditoria
`recordAuditLog` é chamado explicitamente pelos controllers de `track`, `task` e `track-assignment` após cada `create`/`update`/`delete`, gravando um diff campo a campo (relações reduzidas ao id) — não é um snapshot completo como o `TrackVersion`, é um rastro leve de "quem mudou o quê e quando". Nunca falha a operação principal: erro ao auditar só loga.

### 6.7 IA e MCP (resumo — detalhe completo em `ai-mcp.md`)
```
POST /ai-suggestions → MCPService (contexto: trilhas existentes)
                     → AIService (provedor mock | anthropic | gemini)
                     → AIResultValidator (única fronteira de confiança)
                     → grava status "pending_review" — NADA é criado ainda
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
      POST .../approve              POST .../reject
      (cria trilha+tarefas          (grava motivo,
       numa transação;               nada é criado)
       approved ou edited)
```
A IA nunca tem acesso de escrita ao banco; ela só gera texto, que é validado com as **mesmas regras** que a criação manual exigiria (whitelist de campos, dependência só de tarefa anterior, tipos de ação permitidos) antes de virar um rascunho. Materializar a trilha é sempre uma ação humana explícita e atômica (`UPDATE ... WHERE status = 'pending_review'` evita duas aprovações concorrentes da mesma sugestão).

---

## 7. Frontend

**Roteamento**: file-based (TanStack Router), um arquivo por rota em `src/routes/`. `AuthenticatedLayout` envolve cada página protegida e recebe as `roles` permitidas como prop — é o único guard de rota do lado do cliente.

**Rotas**: `login`, `dashboard`, `projects`, `tracks` + `tracks_.$id.tasks` (gestão de tarefas de uma trilha), `assignments`, `approvals`, `users`, `audit-log`, `ai-suggestions` (só gestão) · `my-tracks` + `my-tracks_.$id.tasks` (só colaborador) · `profile` (todos).

**Dados de servidor**: cada domínio tem um `*.service.ts` (`src/services/`) que encapsula o axios (`apiClient`) e mapeia o formato do Strapi (`snake_case`, `{ data, meta }`) para os tipos internos da aplicação (`src/lib/types.ts`). As páginas consomem isso via `useQuery`/`useMutation` do TanStack Query — sem chamada de API direta em componente.

**Tratamento de erro centralizado**: `getApiErrorMessage` (`src/lib/api-error.ts`) traduz qualquer erro do backend (código estável em `details.code`, ou a mensagem crua do plugin `users-permissions`, ou o status HTTP) para uma mensagem em português — é o único lugar que decide "o que mostrar pro usuário quando algo falha", usado por toda mutação via `toast.error(getApiErrorMessage(...))`.

**`apiClient`** (`src/services/api.ts`): injeta o JWT em toda requisição, gera um `x-request-id` por chamada (correlação com o log do backend), e desloga automaticamente em qualquer 401.

---

## 8. Decisões arquiteturais e trade-offs

| Decisão | Por quê | Trade-off aceito |
|---|---|---|
| Strapi como backend (em vez de um framework HTTP puro) | Content-types, plugin de auth/permissões e admin de graça; contexto de estudo do time | Menos controle fino sobre certas convenções do ORM; workarounds documentados (ex.: `sanitizeOutput` removendo relações por permissão — ver `docs/testing.md`) |
| Versionamento por snapshot imutável (`TrackVersion`), em vez de Draft & Publish do Strapi | Precisava congelar o que cada colaborador está executando mesmo se a trilha mudar depois; Draft & Publish não modela "várias versões publicadas simultaneamente em uso" | Mais uma tabela e mais lógica de escrita (`createNextTrackSnapshot`) a manter em sincronia |
| `TaskExecution`/`TrackAssignment` guardam cópia própria do snapshot | Isolamento total entre o que foi atribuído e edições futuras da trilha | Duplicação de dados (aceitável: são JSONs pequenos, e é exatamente a garantia que se queria) |
| Audit log como diff leve, não snapshot completo | "Quem mudou o quê e quando" é suficiente para o caso de uso atual; snapshot completo por evento seria caro e redundante com `TrackVersion` | Não reconstrói o estado inteiro de um registro em um instante passado — só os campos que mudaram |
| IA: camada de provedor abstrata (`AiProvider`) em vez de acoplar direto ao SDK da Anthropic | Trocar de modelo/fornecedor (hoje: mock, Anthropic, Gemini) sem tocar em validador, controller ou frontend | Cada provedor precisa reimplementar o mapeamento de erros da própria API para o vocabulário interno (`AiFlowError`) |
| Validação da saída da IA é a MESMA regra de negócio da criação manual, reaplicada | A IA nunca pode propor algo que o sistema recusaria se um humano tentasse criar à mão — sem essa garantia, o validador seria só cosmético | Duplica (conceitualmente) a regra de dependência entre `task-dependency.ts` e `ai-result-validator.ts`; aceito porque são contextos diferentes (relacional vs. JSON solto) e cada um tem teste próprio |
| MCP com transporte `local` por padrão, `http` como opção mínima | Não havia servidor MCP externo disponível; a ferramenta (`list_existing_tracks`) só precisa consultar o próprio banco | O transporte `http` é deliberadamente simples (sem handshake, sem sessão) e nunca foi testado contra um servidor real — ver `ai-mcp.md` §4 |
| Testes de integração contra Strapi real + Postgres real, não mocks | Mocks não pegariam os bugs reais que apareceram (ex.: `sanitizeOutput` escondendo `role`/`evidences` por permissão) — só apareceram testando a pilha inteira | Suíte de integração é lenta (boot do Strapi ~20-30s, depois requisições reais); ver `testing.md` §2 |
| Sem framework de estado global no frontend | TanStack Query já resolve cache/revalidação de dados de servidor; não há estado de UI complexo o bastante para justificar Redux/Zustand | Nenhum — decisão de baixo risco para o tamanho atual do app |

---

## 9. Segurança

- **RBAC em duas camadas**: policy no backend (fonte da verdade) + guard de rota no frontend (experiência, não segurança).
- **Segredos só no servidor**: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, credenciais de banco — nunca no frontend, nunca commitados (`.env*` no `.gitignore`, `.env.example` só com nomes).
- **Sanitização de saída do Strapi** (`contentAPI.sanitize.output`) remove campos/relações que o perfil autenticado não tem permissão de ler — encontramos e corrigimos dois pontos onde isso escondia dado que o próprio dono deveria ver (`role` em `/me`, `evidences` nas próprias execuções).
- **Erros nunca vazam detalhe interno**: mensagens de erro expostas ao cliente usam um código estável (`details.code`); causa (stack, corpo de erro upstream) fica só no log do servidor.
- **Entrada da IA é sempre tratada como dado, nunca instrução** — o prompt delimita objetivo e contexto (`<objetivo>`, `<trilhas_existentes>`) e instrui o modelo a ignorar qualquer comando embutido neles; a garantia real, porém, é que a IA não tem poder de escrita e passa por revisão humana.

## 10. Observabilidade

`global::request-logger` grava `requestId`, método, rota, status, duração, usuário e role de toda requisição; `utils/logger.ts` serializa exceções (stack, code) e usa `AsyncLocalStorage` (`strapi.requestContext`) para anexar o `requestId` automaticamente a qualquer log emitido durante aquela requisição, mesmo dentro de um service sem acesso direto ao `ctx`. Não há um agregador de logs configurado (ex.: Datadog/Sentry) além da saída padrão do processo.

## 11. Testes

Cobertura completa (tipos, comandos, matriz regra→teste, limitações de instrumentação de cobertura do Strapi) está em [`testing.md`](./testing.md). Resumo: 188 testes de backend (unit + integração), 88 de frontend, 28 E2E (Playwright) cobrindo a jornada completa gestor→colaborador→aprovação e o fluxo de IA com validação humana.

## 12. Deploy

- **Backend**: preparado para Render (`README.md` § Deploy), via `DATABASE_URL` (Internal Database URL quando o Postgres também está no Render). Único workflow de CI hoje: instalar → testes unitários → build (`.github/workflows/build.yml`).
- **Frontend**: sem configuração de deploy documentada no repositório (sem `vercel.json`/`netlify.toml`/README de deploy) — não afirmamos aqui onde ele roda em produção. CI: lint → tipos → testes unitários → build (`.github/workflows/ci.yml`).
- Nenhum dos dois workflows roda testes de integração ou E2E no CI (exigem Postgres de serviço e, no caso do E2E, os dois apps + Playwright) — detalhado em `testing.md` §6.

## 13. Limitações conhecidas

- Cobertura de código não chega a 80% em controllers/serviços grandes do Strapi por uma limitação de instrumentação do `@vitest/coverage-v8` (não é falta de teste real — ver `testing.md` §5.2). As regras extraídas em módulos puros estão ≥85% medido.
- Provedor de IA real (Anthropic e Gemini) nunca foi exercitado com chave verdadeira neste ambiente — só com cliente/`fetch` injetado nos testes.
- Transporte MCP `http` é uma implementação mínima, não testada contra um servidor MCP real.
- Sem rate limit no endpoint de geração de sugestões de IA.
- "Fases" (mencionadas em conversas de produto) não são uma entidade do sistema — é só um rótulo de texto herdado do seed de demonstração; tratado como conceitual por decisão de produto.
- Uma varredura geral de refinamentos de UX (estados de erro/loading inconsistentes, acessibilidade, código morto) ficou pendente — ver `release-checklist.md`.
