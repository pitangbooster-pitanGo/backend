# Checklist de entrega — Pitang Booster

Legenda: **[x]** verificado por teste automatizado ou execução real nesta entrega · **[ ]** **não** verificado / pendente (com motivo).

Última verificação: suíte completa executada localmente (backend 175 testes, frontend 88, E2E 28), `tsc` e lint sem erros.
Detalhes e comandos: [`testing.md`](./testing.md) · IA: [`ai-mcp.md`](./ai-mcp.md).

## Aplicação
- [x] Backend (Strapi) inicia e responde em `/_health` (usado pelo Playwright)
- [x] Frontend inicia e serve `/login`
- [x] `tsc --noEmit` limpo nos dois repositórios; lint sem erros (7 warnings `react-refresh` pré-existentes, sem erro)
- [x] Build do backend e do frontend validados em clone limpo (ver "Verificação de entrega" abaixo)
- [ ] Deploy em ambiente real após o merge — não executado aqui

## Autenticação
- [x] Login válido / inválido (API e E2E)
- [x] Rota protegida sem sessão redireciona ao login (E2E)
- [x] Sessão persiste após refresh e token expirado/corrompido é descartado (E2E + unit)
- [x] Autorização por perfil: colaborador barrado de gestão, liderança barrada da área do colaborador (API 403 + E2E)
- [x] Usuário bloqueado/inativo negado (unit das policies)

## Trilhas
- [x] Criar projeto e trilha (E2E)
- [x] Criar tarefas: comum, com material, com dependência, com evidência + aprovação (E2E)
- [x] Regras de dependência (própria, outra trilha, ordem posterior) (unit + API)
- [x] Versionamento: trilha nasce na versão 1 com snapshot; criar tarefa gera nova versão (API)
- [x] Atribuir trilha a colaborador (E2E)
- [ ] **Fases**: não existe como entidade — tratada como conceitual por decisão de produto (sem cobertura)

## Colaborador
- [x] "Minhas Trilhas", abrir trilha e ver tarefas (E2E)
- [x] Tarefa dependente começa **bloqueada** e libera ao concluir a anterior (E2E + API)
- [x] Acessar material; concluir tarefa simples (E2E)
- [x] Anexar evidência (link) e enviar para aprovação (E2E)
- [ ] Upload de **arquivo** como evidência em E2E — só o caminho por link é exercitado no navegador (o backend valida arquivo/tipo/tamanho em código, sem teste automatizado de upload)

## Aprovação
- [x] Liderança vê a evidência enviada e aprova (E2E)
- [x] Rejeição exige motivo; colaborador vê o feedback, reenvia e é aprovado (API + E2E)
- [x] Papéis sem permissão não aprovam (API 403)

## Progresso
- [x] Progresso 0% → 100% conforme conclusões; `submitted` não conta como concluída (unit + API + E2E)
- [x] Trilha conclui com `completed`/100% e a UI reflete (E2E)

## IA/MCP
- [x] Geração cria **rascunho** `pending_review` e **não** cria trilha/tarefa (API + E2E)
- [x] Aprovar (sem/com edição), rejeitar, estados finais imutáveis, aprovação concorrente, rollback (API)
- [x] Falhas de IA (erro, timeout, vazio, inválido) e do MCP (indisponível, timeout, inválido) tratadas (unit + API)
- [x] Chave de API só no servidor; nada de segredo no repositório
- [ ] **Provedor de IA real (`AI_PROVIDER=anthropic`) não foi exercitado** — sem chave no ambiente de desenvolvimento; coberto só com cliente injetado. **BLOQUEIO parcial** (ver abaixo)
- [ ] Servidor MCP externo (`MCP_TRANSPORT=http`) não testado contra um servidor real
- [ ] Rate limit no endpoint de geração — não implementado

## Qualidade
- [x] Testes unitários, integração e E2E passando (números acima)
- [x] Dados de teste isolados (schema `pitang_test`); massa de demonstração intocada
- [x] Cobertura medida e documentada (meta × real); lacunas listadas em `testing.md` §5.4
- [ ] **Cobertura ≥ 80% nas regras críticas em controllers/serviços grandes do Strapi** — **não atingida** (regras extraídas: ≥ 85% medido; o restante só funcional). Ver `testing.md` §5
- [x] CI: unit no backend, lint/tipos/unit/build no frontend
- [ ] CI **não** roda integração nem E2E (faltam Postgres de serviço e Playwright no workflow) — `testing.md` §6

## UX
- [x] Loading/estado vazio/erro na tela de sugestões de IA; botões desabilitados durante ações
- [x] Labels com `htmlFor` nos diálogos de tarefa, atribuição e rejeição
- [ ] **Varredura geral de refinamentos NÃO realizada** (console errors, requisições duplicadas, responsividade, acessibilidade completa, código morto, TODOs) — fase 8 pulada por falta de tempo; fica como pendência

---

## BLOQUEIOS e riscos

**BLOQUEIO 1 — Provedor de IA real não validado**
- **Motivo:** não há `ANTHROPIC_API_KEY` no ambiente de desenvolvimento.
- **Impacto:** o modo `mock` (padrão) funciona ponta a ponta; com `AI_PROVIDER=anthropic` a primeira chamada real pode pedir ajuste de prompt/parâmetros.
- **Como reproduzir:** definir `AI_PROVIDER=anthropic` e `ANTHROPIC_API_KEY` no backend e gerar uma sugestão em `/ai-suggestions`.
- **O que falta:** uma chave e uma execução real.

**Risco 2 — Acoplamento entre suítes** (integração e E2E compartilham o schema `pitang_test`): ver `testing.md` §3.

**Risco 3 — Interrupção do Supabase durante a entrega:** o projeto Supabase ficou indisponível por um período (`tenant not found`) e voltou; a suíte foi revalidada contra ele. Convém confirmar que o projeto não é pausado por inatividade.

## Verificação de entrega
Antes do push, ambos os repositórios foram clonados do estado commitado para um diretório limpo e executados com os **mesmos comandos do CI** (backend: `yarn install --frozen-lockfile` → `test:unit` → `build`; frontend: `npm ci` → lint → `tsc` → testes → build). Resultado registrado no relatório final da entrega.
