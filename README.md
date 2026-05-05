# Pitang Booster - Backend

Este repositório é o backend de uma aplicação criada como parte de um ciclo de estudos do **Pitang Booster**, programa de desenvolvimento de carreira da Pitang.

O projeto foi pensado a partir de um contexto comum em equipes que recebem novos projetos ou novos integrantes: como organizar informações, atividades e etapas de onboarding de um jeito mais claro, acompanhável e reaproveitável.

O projeto usa **Strapi** por ser uma ferramenta presente no contexto da equipe de trabalho e por permitir explorar, na prática, content types, permissões, autenticação, policies, controllers, services, rotas customizadas e integração com banco de dados.

## Objetivo do Projeto

A aplicação simula uma plataforma de onboarding e acompanhamento de trilhas de desenvolvimento para colaboradores alocados em projetos.

Nela, pessoas responsáveis pelo acompanhamento podem criar projetos, montar trilhas, organizar tarefas em uma ordem lógica e atribuir essas trilhas para colaboradores. A partir disso, o colaborador consegue visualizar as trilhas recebidas, acompanhar as tarefas liberadas e avançar conforme conclui cada etapa.

O backend também calcula o progresso da trilha e respeita dependências entre tarefas. Ou seja: uma tarefa pode ficar bloqueada até que outra seja concluída.

Esse fluxo busca apoiar um melhor aproveitamento do conhecimento já organizado pela equipe. Em vez de cada onboarding depender apenas de conversas soltas ou materiais espalhados, a aplicação propõe uma estrutura em que trilhas e tarefas podem ser reaproveitadas, acompanhadas e evoluídas.

## O Que Foi Trabalhado

Durante o desenvolvimento, o projeto foi evoluído por etapas, seguindo os encontros do Pitang Booster:

- planejamento funcional;
- priorização com MoSCoW;
- modelagem ER;
- criação das principais entidades do domínio;
- configuração de backend e banco de dados;
- autenticação com JWT;
- controle de acesso por perfil;
- validação de regras de negócio;
- execução de trilhas por usuário;
- cálculo de progresso;
- scripts de validação para testar fluxos importantes.

## Perfis da Aplicação

O sistema trabalha com quatro perfis principais.

### Admin

Perfil com acesso amplo para gerenciar a aplicação. Pode criar e editar projetos, trilhas, tarefas, atribuições de trilhas e acompanhar execuções.

### RH

Perfil voltado para gestão de onboarding e desenvolvimento. Pode criar e organizar trilhas, gerenciar tarefas e atribuir trilhas para colaboradores.

### Liderança

Perfil pensado para acompanhar e organizar trilhas relacionadas a times ou projetos. Também possui permissões de gestão sobre projetos, trilhas, tarefas e atribuições.

### Colaborador

Perfil de quem recebe as trilhas. Pode visualizar projetos, trilhas e tarefas disponíveis para si, consultar suas atribuições e concluir tarefas liberadas.

## Principais Entidades

### Projects

Representam projetos ou contextos onde uma trilha pode estar relacionada. Um projeto pode ter várias trilhas vinculadas.

### Tracks

Representam trilhas de onboarding ou desenvolvimento. Existem trilhas institucionais e trilhas de projeto.

Campos importantes:

- `track_type`: define se a trilha é institucional ou de projeto;
- `version`: permite registrar a versão da trilha no momento da atribuição;
- `is_active`: controla se a trilha está ativa;
- `created_by_user`: registra quem criou a trilha.

### Tasks

Representam as tarefas de uma trilha. Cada tarefa possui uma ordem, tipo de ação e possíveis regras adicionais.

Campos importantes:

- `order_index`: define a ordem da tarefa na trilha;
- `depends_on`: define dependências entre tarefas;
- `requires_manual_approval`: indica se a tarefa precisa de aprovação manual;
- `requires_evidence`: indica se a tarefa exige alguma evidência;
- `action_type`: classifica o tipo da tarefa, como leitura, formulário, upload ou link externo.

### Track Assignments

Representam uma trilha atribuída a um usuário. Guardam status, progresso, usuário responsável, quem atribuiu e a versão da trilha no momento da atribuição.

Status possíveis:

- `not_started`;
- `in_progress`;
- `completed`;
- `cancelled`.

### Task Executions

Representam a execução de uma tarefa dentro de uma trilha atribuída. Essa entidade permite acompanhar o estado individual de cada tarefa para cada colaborador.

Status possíveis:

- `locked`;
- `available`;
- `in_progress`;
- `submitted`;
- `approved`;
- `rejected`;
- `completed`.

## Regras de Negócio

Algumas regras implementadas no backend:

- apenas usuários ativos podem acessar rotas protegidas;
- `admin`, `hr` e `leadership` podem gerenciar projetos, trilhas, tarefas e atribuições;
- `employee` só acessa recursos permitidos para o próprio fluxo;
- tarefas com dependências só são liberadas quando as tarefas anteriores forem concluídas;
- uma tarefa não pode depender dela mesma;
- dependências precisam pertencer à mesma trilha;
- dependências precisam ter ordem anterior à tarefa atual;
- ao atribuir uma trilha, o sistema cria as execuções das tarefas automaticamente;
- tarefas sem dependência começam como `available`;
- tarefas com dependência começam como `locked`;
- o progresso da trilha é calculado com base nas tarefas concluídas;
- tarefas que exigem aprovação manual viram `submitted` e não contam como concluídas até aprovação.

## Autenticação e Autorização

A autenticação usa o plugin `users-permissions` do Strapi, com login via JWT.

Além das permissões do plugin, o projeto possui policies próprias:

- `is-active-user`: bloqueia usuários inexistentes, bloqueados ou inativos;
- `has-role`: restringe rotas de acordo com o perfil do usuário.

Também existe uma rota customizada `/me`, que retorna os dados do usuário autenticado junto com seu papel.

## Rotas Customizadas

Além dos CRUDs gerados pelo Strapi, o projeto possui rotas específicas para os fluxos da aplicação:

```txt
GET /me
GET /my-track-assignments
GET /my-track-assignments/:id/tasks
POST /task-executions/:id/complete
```

Essas rotas permitem que o colaborador veja suas próprias trilhas e avance nas tarefas disponíveis.

## Scripts de Validação

O projeto possui scripts para validar os fluxos principais dos encontros.

```bash
npm run validate:encontro6
npm run validate:encontro7
```

O script do Encontro 6 valida:

- criação de projetos;
- criação de trilhas institucionais e de projeto;
- criação de tarefas;
- validação de dependências;
- atribuição de trilha para colaborador;
- visualização da trilha atribuída pelo colaborador.

O script do Encontro 7 valida:

- criação de execuções de tarefas;
- bloqueio inicial por dependência;
- liberação de tarefas conforme conclusão;
- cálculo de progresso;
- comportamento de tarefa com aprovação manual.

## Tecnologias

- Node.js;
- TypeScript;
- Strapi 5;
- PostgreSQL;
- Docker Compose;
- Render para deploy.

## Rodando Localmente

Instale as dependências:

```bash
npm install
```

Suba o banco local com Docker:

```bash
docker compose up -d
```

Crie um arquivo `.env` com base no `.env.example`.

Para usar o banco local do `docker-compose.yml`, configure:

```env
DATABASE_CLIENT=postgres
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=pitango
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=postgres
DATABASE_SSL=false
DATABASE_SCHEMA=public
```

Inicie o Strapi em modo desenvolvimento:

```bash
npm run dev
```

O admin do Strapi fica disponível em:

```txt
http://localhost:1337/admin
```

## Criando ou Resetando um Admin Local

Os usuários da aplicação não são a mesma coisa que usuários do painel administrativo do Strapi.

Para criar um usuário admin do painel:

```bash
npm run strapi admin:create-user -- -e seu-email@exemplo.com -p Senha@123 -f SeuNome -l SeuSobrenome
```

Para resetar a senha:

```bash
npm run strapi admin:reset-password -- -e seu-email@exemplo.com -p NovaSenha@123
```

## Deploy

O projeto foi preparado para deploy no Render.

No Render, a configuração mais simples é usar `DATABASE_URL`.

Para um serviço hospedado dentro do Render, use a **Internal Database URL** do banco:

```env
DATABASE_CLIENT=postgres
DATABASE_URL=postgresql://usuario:senha@host-interno/nome-do-banco
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=false
```

Para rodar localmente apontando para o banco do Render, use a **External Database URL** e SSL:

```env
DATABASE_CLIENT=postgres
DATABASE_URL=postgresql://usuario:senha@host-externo/nome-do-banco
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=false
```

## Observações de Segurança

Este projeto nasceu como estudo guiado, então algumas decisões foram tomadas pensando em aprendizado e validação rápida dos fluxos.

Antes de usar em ambiente real, seria importante revisar principalmente:

- secrets e senhas de ambiente;
- envio de email por provider SMTP autenticado;
- rotação de credenciais expostas durante testes;
- seeds automáticas de usuários;
- regras completas de aprovação manual;
- logs e tratamento de erros;
- testes automatizados além dos scripts de validação.

## Aprendizados do Projeto

Mais do que entregar endpoints, o projeto serviu para praticar uma forma mais estruturada de construir backend.

Durante o processo, a relação entre planejamento e implementação foi uma parte importante do estudo: primeiro entender as entidades, depois pensar nas permissões, depois validar as regras de negócio e só então testar os fluxos de ponta a ponta.

Também foi uma oportunidade de exercitar comunicação técnica. Cada regra implementada precisava fazer sentido dentro do domínio, não apenas dentro do código. Esse foi um dos pontos centrais do trabalho no Pitang Booster.
