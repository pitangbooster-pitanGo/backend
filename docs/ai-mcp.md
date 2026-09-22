# IA e MCP — sugestão de trilhas com validação humana

## 1. Objetivo

Antes desta entrega **não existia nenhum código de IA** neste projeto (nem dependência, rota ou serviço). O caso de uso implementado é:

> A pessoa gestora descreve, em texto livre, o objetivo de uma trilha. A IA **propõe** uma estrutura (trilha + tarefas, com tipo de ação, exigência de evidência/aprovação e dependências). A pessoa **revisa, edita, aprova ou rejeita**. Só a aprovação cria a trilha de verdade.

A regra central: **a IA nunca executa uma ação crítica sozinha.** Gerar uma sugestão só grava um rascunho; criar trilha e tarefas exige uma ação humana explícita, registrada com autoria e data.

## 2. Arquitetura

```
Frontend ──▶ Backend (Strapi) ──▶ AIService ──▶ Provedor (mock | anthropic)
 (nunca vê       │                    ▲
  chave)         │                    │ contexto
                 ├──▶ MCPService ─────┘   (ferramenta list_existing_tracks)
                 │
                 ▼
          AIResultValidator ──▶ rascunho "pending_review" (banco)
                                        │
                     ┌──── revisão humana (approve / reject) ────┐
                     ▼                                           ▼
        cria trilha + tarefas (transação)                  nada é criado
```

Camadas (tudo em `src/api/ai-suggestion/services/`, seguindo o padrão de módulos de serviço já usado em `task-execution/services/`):

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| **AIService** | `ai-service.ts` | Escolhe o provedor (`AI_PROVIDER`), aplica timeout com `AbortSignal`, traduz qualquer falha em `AiFlowError` com código estável, rejeita resposta vazia. **Não interpreta** o conteúdo. |
| Provedor mock | `mock-provider.ts` | Determinístico, sem rede e sem custo. Padrão quando não há chave. |
| Provedor Anthropic | `anthropic-provider.ts` | SDK oficial `@anthropic-ai/sdk`; chave só do ambiente do servidor. |
| **MCPService** | `mcp-service.ts` | Único ponto de chamada de ferramentas. Transportes `local` e `http`. |
| **AIResultValidator** | `ai-result-validator.ts` | **Única fronteira de confiança** sobre a saída da IA: parse, whitelist de campos, tipos, limites e regras de dependência. |
| Orquestração | `suggestion-generation.ts` | MCP → IA → validador → rascunho (com degradação do MCP). |
| Materialização | `suggestion-materialization.ts` | Cria trilha + tarefas + dependências + snapshot **após** aprovação humana. |
| Tipos/erros | `ai-types.ts`, `ai-errors.ts` | Contratos e `AiFlowError` (+ `runWithTimeout`). |
| HTTP | `controllers/ai-suggestion.ts`, `routes/*.ts` | `create`, `approve`, `reject` e leitura. |
| Config | `config/ai.ts` | Lê variáveis de ambiente. |

Frontend: `src/routes/ai-suggestions.tsx` (página), `src/components/ai/SuggestionReview.tsx` (revisão), `src/services/ai-suggestions.service.ts`, `src/lib/ai-suggestion.ts` (tipos e regras puras). O frontend só fala com o backend; **nenhuma chave ou chamada de IA existe no navegador**.

## 3. Fluxo passo a passo

1. `POST /api/ai-suggestions` com `{ data: { goal, track_type? } }` (perfis admin/RH/liderança). `goal` precisa ter 10–2000 caracteres.
2. **MCP:** `list_existing_tracks` devolve as trilhas ativas (até 50 — nome, descrição, tipo) para a IA evitar duplicidade. Se falhar, o fluxo **segue sem o contexto** e registra o aviso `MCP_CONTEXT_UNAVAILABLE`.
3. **IA:** o provedor recebe objetivo + catálogo e devolve **texto bruto**.
4. **Validador:** o texto vira uma estrutura validada e normalizada (§5) ou o fluxo falha com `AI_RESULT_INVALID`. O estado `generated` existe só aqui, em memória; o que se persiste já é `pending_review`.
5. O rascunho é gravado com `status = pending_review`, `original_result`, `warnings`, `provider`, `model`, `created_by_user`. **Nenhuma trilha/tarefa é criada.**
6. Uma pessoa abre a sugestão e decide:
   - `POST /api/ai-suggestions/:id/approve` (com `final_result` opcional se editou) → cria a trilha.
   - `POST /api/ai-suggestions/:id/reject` (com `review_notes` obrigatório) → nada é criado.

## 4. MCP utilizado

**Ferramenta:** `list_existing_tracks` — contrato no estilo MCP (`name`, `description`, `inputSchema` JSON Schema, `handler`). Entrada: `{ limit?: 1..50 }`. Saída esperada: `{ tracks: [{ name, description?, track_type? }] }` (ou a lista direta). A saída é **validada** (nome obrigatório, textos truncados, no máximo 50 itens) — formato inválido é `MCP_INVALID_RESPONSE`.

**Transportes** (`MCP_TRANSPORT`):

| Transporte | O que é | Quando usar |
|---|---|---|
| `local` (padrão) | Registro de ferramentas em processo; a ferramenta consulta o banco do próprio Strapi | Desenvolvimento, testes e produção simples |
| `http` | Chamada JSON-RPC 2.0 `tools/call` a um servidor MCP em `MCP_SERVER_URL`, resposta única | Quando houver um servidor MCP externo |

**Limitações honestas do transporte `http`:** é uma implementação mínima — não faz o handshake `initialize`, não mantém sessão e não trata respostas em stream (SSE). Serve a servidores MCP *stateless* que aceitem `tools/call` direto. Não foi testado contra um servidor MCP real (só contra `fetch` simulado). A orquestração é **feita pelo backend** (a ferramenta é chamada antes do modelo); não é um laço agêntico em que o modelo escolhe ferramentas.

## 5. Entradas e saídas

**Requisição**
```json
POST /api/ai-suggestions
{ "data": { "goal": "Onboarding de pessoas backend no projeto X", "track_type": "project" } }
```

**Resposta (201)** — `data`:
```json
{
  "id": 12, "documentId": "…",
  "goal": "…", "track_type": "project",
  "status": "pending_review",
  "original_result": {
    "track": { "name": "…", "description": "…", "track_type": "project" },
    "tasks": [
      { "title": "…", "description": "…", "order_index": 1, "action_type": "reading",
        "requires_evidence": false, "requires_manual_approval": false, "depends_on": [] },
      { "title": "…", "order_index": 2, "action_type": "upload",
        "requires_evidence": true, "requires_manual_approval": true, "depends_on": [1] }
    ]
  },
  "final_result": null,
  "warnings": [{ "code": "DUPLICATE_TRACK_NAME", "message": "…" }],
  "provider": "mock", "model": "mock",
  "reviewed_at": null, "review_notes": null, "track": null
}
```

**Regras do `AIResultValidator`** (mesmas que a criação real exigiria — a IA nunca propõe algo que o sistema rejeitaria):
- Aceita JSON puro, dentro de cerca markdown ou com texto ao redor; qualquer outra coisa é inválida.
- Só campos conhecidos são copiados (whitelist); `order_index` é **ignorado** e recalculado pela posição.
- Trilha: nome obrigatório (≤120), descrição ≤1000, `track_type` válido (senão usa o do pedido).
- Tarefas: 1 a 20; título obrigatório (≤150); descrição ≤1000; `action_type` ∈ `reading | form | upload` (**`external_link` é recusado** — exigiria uma URL que a IA não tem como fornecer); booleanos só valem se `=== true`.
- `depends_on`: lista de **posições (1-based) estritamente anteriores**, sem repetição — espelha `TASK_DEPENDENCY_ORDER_INVALID` do backend.
- Caracteres de controle são removidos; quebras de linha preservadas.
- Avisos (não rejeitam): `DUPLICATE_TRACK_NAME`, `DUPLICATE_TASK_TITLE`, `MCP_CONTEXT_UNAVAILABLE`.

## 6. Tratamento de erros

Falhas da IA/MCP viram `AiFlowError` e respondem com `{ data: null, error: { status, name: "AiFlowError", message, details: { code, … } } }`. **Nada é persistido** e a causa interna (`cause`) **nunca** sai na resposta (fica só no log do servidor).

| Código | HTTP | Quando |
|---|---|---|
| `AI_GOAL_INVALID` | 400 | Objetivo vazio, curto (<10) ou longo (>2000) |
| `AI_NOT_CONFIGURED` | 503 | `AI_PROVIDER=anthropic` sem `ANTHROPIC_API_KEY`, `AI_PROVIDER=gemini` sem `GEMINI_API_KEY`, ou provedor desconhecido |
| `AI_PROVIDER_TIMEOUT` | 504 | Provedor passou de `AI_TIMEOUT_MS` (o `AbortSignal` é acionado; vale mesmo se o provedor ignorá-lo) |
| `AI_PROVIDER_ERROR` | 502 | Erro HTTP/rede do provedor, recusa do modelo (Anthropic `stop_reason: refusal`; Gemini `promptFeedback.blockReason` ou `finishReason` de bloqueio) ou exceção inesperada. Só o status HTTP de origem é exposto |
| `AI_EMPTY_RESPONSE` | 502 | Resposta vazia |
| `AI_RESULT_INVALID` | 502 | Não é JSON / não segue o formato / dependência inválida (`details.issues` lista até 20 problemas) |
| `MCP_TOOL_UNAVAILABLE` · `MCP_TIMEOUT` · `MCP_INVALID_RESPONSE` | — | **Não interrompem a geração**: viram o aviso `MCP_CONTEXT_UNAVAILABLE` na sugestão |

Erros de revisão (`approve`/`reject`): `AI_SUGGESTION_NOT_FOUND` (404), `AI_SUGGESTION_NOT_PENDING` (400 — já revisada), `AI_SUGGESTION_EDIT_INVALID` (400, com `issues`), `AI_SUGGESTION_NOTES_INVALID` / `AI_SUGGESTION_REJECTION_NOTES_REQUIRED` (400), `AI_SUGGESTION_APPROVE_FAILED` / `…_REJECT_FAILED` (500). O frontend traduz todos os códigos em mensagens em português (`src/lib/api-error.ts`).

## 7. Validação humana

**Estados** (`status`): `pending_review` → `approved` | `edited` | `rejected`.

- `approved`: aprovada sem alterações. `edited`: aprovada **com** edições. A distinção é decidida no backend comparando o `final_result` enviado com o `original_result` (enviar um resultado idêntico conta como `approved`).
- Estados finais são **imutáveis**: não dá para aprovar de novo, rejeitar depois de aprovada, nem aprovar depois de rejeitada.
- Não há `PUT`/`DELETE` genérico na API; só `approve` e `reject` movem o status.

**O que é registrado** (campos do content-type `ai-suggestion`, todos necessários para este registro):

| Campo | Conteúdo |
|---|---|
| `original_result` | O que a IA propôs — **nunca alterado** |
| `final_result` | O que foi efetivamente aprovado (`null` se pendente/rejeitada) |
| `created_by_user` / `reviewed_by_user` | Quem gerou / quem revisou |
| `reviewed_at` · `review_notes` | Data e observações (motivo, se rejeitada) |
| `track` | Trilha criada, quando aprovada |
| `provider` · `model` · `warnings` | Origem da sugestão e avisos mostrados ao revisor |

**Garantias da aprovação** (`approve`):
- **Atômica contra concorrência:** o status é reivindicado com `UPDATE … WHERE status = 'pending_review'`; entre várias aprovações simultâneas exatamente uma vence.
- **Transacional:** trilha, tarefas, dependências, snapshot e o registro da revisão são criados numa única transação — qualquer falha desfaz tudo e a sugestão continua `pending_review`.
- **Trilha nasce na versão 1** já com todas as tarefas no snapshot (diferente do fluxo manual, que gera uma versão por tarefa). Auditoria (`audit-log`) registra a criação em nome do revisor.
- Uma estrutura editada passa **novamente** pelo `AIResultValidator` (erro de formato = 400, não 502).

**Quem pode:** `admin`, `hr`, `leadership` (policies `is-active-user` + `has-role`). Colaboradores recebem 403. A pessoa que gerou a sugestão **pode** aprová-la (é o caso de uso: quem descreve, revisa).

**Interface** (`/ai-suggestions`): gerar, listar, revisar em diálogo. Na revisão dá para editar nome/descrição da trilha e título, descrição, tipo, evidência e aprovação de cada tarefa, e **remover** tarefas (dependências são reindexadas). Não dá para adicionar nem reordenar tarefas. O selo "Modo simulado (sem IA real)" aparece quando `provider = mock`.

## 8. Variáveis de ambiente

Nunca versionar valores reais. `.env.example` lista os nomes com valores seguros.

| Variável | Padrão | Descrição |
|---|---|---|
| `AI_PROVIDER` | `mock` | `mock`, `anthropic` ou `gemini` |
| `ANTHROPIC_API_KEY` | vazio | Só é usada com `AI_PROVIDER=anthropic`. **Somente no servidor.** |
| `GEMINI_API_KEY` | vazio | Só é usada com `AI_PROVIDER=gemini`. **Somente no servidor.** |
| `AI_MODEL` | acompanha o provedor | Modelo do provedor escolhido. Padrão `claude-opus-5` com `anthropic` e `gemini-3.8-flash` com `gemini` |
| `AI_TIMEOUT_MS` | `60000` | Timeout da chamada de IA |
| `MCP_TRANSPORT` | `local` | `local` ou `http` |
| `MCP_SERVER_URL` | vazio | URL do servidor MCP (só com `http`) |
| `MCP_TIMEOUT_MS` | `5000` | Timeout da chamada MCP |

**Ativar a IA real:** no ambiente do backend (Render/host), sem tocar no frontend:

- **Anthropic** — `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY=<chave>`. Usa `client.messages.create` do SDK oficial com `max_tokens: 16000` e `output_config.effort: "medium"`.
- **Gemini** — `AI_PROVIDER=gemini` + `GEMINI_API_KEY=<chave>`. Chama `POST v1beta/models/<AI_MODEL>:generateContent` da Generative Language API via `fetch`, com a chave no cabeçalho `x-goog-api-key` (nunca na query string, que vaza em log de proxy) e `generationConfig.responseMimeType: "application/json"`. Não define `maxOutputTokens`: um corte no meio devolveria JSON truncado, que viraria `AI_RESULT_INVALID` em vez de uma falha clara — o tamanho já é limitado por `maxTasks` no prompt.

Os dois provedores compartilham os mesmos prompts (`buildSystemPrompt` / `buildUserPrompt`) e devolvem texto bruto, então o AIResultValidator continua sendo a única fronteira de confiança e trocar de provedor não muda nenhum contrato interno.

## 9. Testes

Nenhum teste chama IA real: o harness força o provedor `mock`.

- **Unitários** (`tests/unit/`): `ai-result-validator` (formatos, whitelist, todas as regras de dependência, limites), `ai-service` (sucesso, timeout com/sem `AbortSignal`, exceção, resposta vazia, provedor desconhecido; provedor Anthropic com **cliente injetado**: sem chave, corpo da requisição, chave fora do payload, `refusal`, timeout e erro HTTP do SDK), `mcp-service` (local e http: sucesso, ferramenta indisponível, timeout, HTTP não-2xx, erro RPC, resposta inválida), `suggestion-generation` (fluxo completo; MCP falhando degrada com aviso; falha/resposta inválida da IA interrompem).
- **Integração** (`ai-suggestion.test.ts`, `ai-suggestion-review.test.ts`, 36 testes): geração pendente **sem criar trilha**, cada falha de IA via HTTP sem persistir nem vazar `cause`, revisão humana completa, concorrência e rollback.
- **Frontend + E2E:** componente de revisão (aprovar sem editar não envia `finalResult`, edição, remoção, rejeição exige motivo, somente leitura) e `ai-suggestions.spec.ts`.
- **Simular falhas em dev/E2E:** o provedor mock aceita marcadores no objetivo — `[[mock:error]]`, `[[mock:empty]]`, `[[mock:invalid]]`, `[[mock:invalid-deps]]`, `[[mock:timeout]]`.

Comandos e cobertura: [`testing.md`](./testing.md).

## 10. Segurança

- **Chave só no servidor**, lida de variável de ambiente; nunca no frontend, no repositório ou nos logs/respostas (há teste garantindo que ela não vai no corpo da requisição à IA).
- **Sem execução automática:** o endpoint de geração só grava rascunho; criar dados exige `approve` por uma pessoa autenticada com perfil de gestão.
- **Saída não confiável:** tudo que a IA devolve passa pelo validador (whitelist + limites) antes de ser exibido ou gravado; o frontend renderiza como texto (React), sem HTML.
- **Injeção de prompt:** o prompt delimita o objetivo e o catálogo (`<objetivo>`, `<trilhas_existentes>`) e os declara como *dados*. Isto é mitigação, não garantia — a defesa real é que **a IA não tem nenhum poder de escrita** e há revisão humana antes de qualquer efeito.
- **Erros não vazam detalhes internos** (só código, mensagem segura e status HTTP de origem).

## 11. Limitações conhecidas

- **O provedor Anthropic real não foi exercitado** — não havia chave no ambiente de desenvolvimento. Está coberto por testes com cliente injetado, mas a primeira chamada real pode exigir ajuste de prompt ou de parâmetros (ex.: o `effort`).
- **Sem limite de requisições (rate limit)** no endpoint: cada geração tem custo de IA. Recomenda-se limite por usuário antes de expor a muitos perfis.
- **MCP `http` mínimo** (§4) e **sem laço agêntico**: o modelo não escolhe ferramentas.
- **Sem streaming** da resposta: a geração é uma requisição única (timeout do axios no frontend: 120 s).
- **Sem histórico de tentativas com falha:** falhas de IA não são persistidas (só logadas).
- **Edição limitada** na revisão: sem adicionar/reordenar tarefas e sem materiais nas tarefas sugeridas.
- **`action_type` restrito** a `reading | form | upload`.
- **Avaliação de qualidade da sugestão** (relevância do conteúdo) não é automatizada — é justamente o papel da revisão humana.
