'use strict';

process.env.SKIP_APP_BOOTSTRAP = 'true';

const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'PitangDemo@123';
const DEMO_DOMAIN = '@pitang.demo';
const stage = process.argv.find((argument) => argument.startsWith('--stage='))?.split('=')[1] || 'all';

const users = [
  ['admin.demo', 'admin@pitang.demo', 'Administrador Demo', 'admin'],
  ['maira.demo', 'maira@pitang.demo', 'Mairá', 'hr'],
  ['massilon.demo', 'massilon@pitang.demo', 'Massilon', 'leadership'],
  ['anne.demo', 'anne@pitang.demo', 'Anne', 'employee'],
  ['eduarda.demo', 'eduarda@pitang.demo', 'Eduarda', 'employee'],
  ['diego.demo', 'diego@pitang.demo', 'Diego', 'employee'],
  ['jadley.demo', 'jadley@pitang.demo', 'Jadley', 'employee'],
  ['danilo.demo', 'danilo@pitang.demo', 'Danilo', 'employee'],
];

const L = (title, url, description = 'Material externo de demonstração.') => ({
  title, description, material_type: 'link', external_url: url,
});
const F = (title, asset, description = 'Arquivo de demonstração para download.') => ({
  title, description, material_type: 'file', asset,
});
const T = (title, phase, options = {}) => ({ title, phase, ...options });

const tracks = [
  {
    name: 'Cultura e Onboarding Pitang', type: 'institutional',
    description: 'Apresenta a empresa, a cultura, os processos e as ferramentas essenciais.',
    tasks: [
      T('Conhecer a história da Pitang', 'Conhecendo a Pitang', { materials: [L('Site institucional da Pitang', 'https://www.pitang.com/')] }),
      T('Ler sobre cultura e valores', 'Conhecendo a Pitang', { materials: [F('Guia de cultura — demo', 'pitang-demo-guia.txt')] }),
      T('Conhecer áreas e estrutura organizacional', 'Conhecendo a Pitang', { evidence: true }),
      T('Configurar e-mail corporativo', 'Ferramentas Corporativas', { materials: [L('Ajuda do Gmail', 'https://support.google.com/mail/')] }),
      T('Acessar ferramentas internas', 'Ferramentas Corporativas', { evidence: true }),
      T('Conhecer canais de comunicação', 'Ferramentas Corporativas', { materials: [L('Ajuda do Google Chat', 'https://support.google.com/chat/')] }),
      T('Checklist final de onboarding', 'Conclusão do Onboarding', { evidence: true, approval: true, materials: [F('Checklist de onboarding — demo', 'pitang-demo-checklist.txt')] }),
    ],
  },
  {
    name: 'Segurança da Informação', type: 'institutional',
    description: 'Boas práticas de segurança, privacidade, credenciais e proteção de dados.',
    tasks: [
      T('Política de senhas', 'Fundamentos', { materials: [L('OWASP Authentication', 'https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html')] }),
      T('Phishing e engenharia social', 'Fundamentos', { materials: [L('Cartilha CERT.br', 'https://cartilha.cert.br/')] }),
      T('Uso seguro de dispositivos', 'Fundamentos'),
      T('Uso correto de credenciais', 'Boas práticas no dia a dia'),
      T('Boas práticas com Git e tokens', 'Boas práticas no dia a dia', { materials: [L('GitHub: segurança', 'https://docs.github.com/pt/authentication/keeping-your-account-and-data-secure')] }),
      T('LGPD e classificação da informação', 'Boas práticas no dia a dia', { evidence: true }),
      T('Concluir avaliação de segurança', 'Avaliação', { evidence: true, approval: true }),
    ],
  },
  {
    name: 'Desenvolvimento e Evolução Profissional', type: 'institutional',
    description: 'Planejamento, execução e acompanhamento do desenvolvimento profissional.',
    tasks: [
      T('Definir objetivo de evolução', 'Planejamento de desenvolvimento', { evidence: true }),
      T('Escolher competências prioritárias', 'Planejamento de desenvolvimento', { evidence: true }),
      T('Realizar treinamento', 'Execução', { materials: [L('MDN Learn', 'https://developer.mozilla.org/pt-BR/docs/Learn')] }),
      T('Aplicar conhecimento em uma atividade prática', 'Execução', { evidence: true }),
      T('Enviar evidência do aprendizado', 'Evidência e feedback', { evidence: true }),
      T('Solicitar feedback da liderança', 'Evidência e feedback', { evidence: true, approval: true }),
    ],
  },
  {
    name: 'Onboarding Projeto Tramontina', type: 'project', project: 'Tramontina',
    description: 'Prepara o colaborador para atuar no projeto Tramontina.',
    tasks: [
      T('Solicitar acessos necessários', 'Acessos'),
      T('Baixar e configurar VPN', 'Acessos', { evidence: true, materials: [F('Tutorial de VPN — demo', 'pitang-demo-guia.txt')] }),
      T('Validar conexão com ambiente do cliente', 'Acessos', { evidence: true }),
      T('Conhecer arquitetura da aplicação', 'Conhecimento do Projeto'),
      T('Conhecer os ambientes', 'Conhecimento do Projeto'),
      T('Conhecer fluxo de deploy', 'Conhecimento do Projeto'),
      T('Entender os principais módulos do sistema', 'Conhecimento do Projeto'),
      T('Rodar projeto localmente', 'Primeira atividade', { evidence: true }),
      T('Realizar primeira alteração simples', 'Primeira atividade', { evidence: true }),
      T('Abrir PR seguindo o padrão do time', 'Primeira atividade', { evidence: true, approval: true, materials: [L('Documentação de Pull Requests', 'https://docs.github.com/pt/pull-requests')] }),
    ],
  },
  {
    name: 'Onboarding Projeto In Forma', type: 'project', project: 'In Forma',
    description: 'Prepara o ambiente e o conhecimento necessário para atuar no In Forma.',
    tasks: [
      T('Solicitar acessos', 'Ambiente de Trabalho'), T('Baixar e configurar VM', 'Ambiente de Trabalho', { evidence: true }),
      T('Validar acesso remoto', 'Ambiente de Trabalho', { evidence: true }), T('Configurar ferramentas necessárias', 'Ambiente de Trabalho'),
      T('Conhecer o EQM', 'EQM'), T('Configurar ambiente', 'EQM'), T('Rodar frontend', 'EQM'), T('Rodar backend', 'EQM'),
      T('Conhecer principais módulos', 'EQM'), T('Entender fluxo de migração do sistema legado para Web', 'EQM', { materials: [F('Guia de arquitetura — demo', 'pitang-demo-guia.txt')] }),
      T('Corrigir uma issue simples', 'Primeira Entrega', { evidence: true }), T('Validar em ambiente de desenvolvimento', 'Primeira Entrega'),
      T('Criar PR', 'Primeira Entrega', { evidence: true }), T('Validar em homologação', 'Primeira Entrega', { evidence: true, approval: true }),
    ],
  },
  {
    name: 'Onboarding Projeto Sola', type: 'project', project: 'Sola',
    description: 'Prepara o colaborador para trabalhar com o ecossistema mobile do projeto.',
    tasks: [
      T('Entender como funciona o aplicativo', 'Conhecendo o Produto'), T('Conhecer o fluxo da loja de aplicativos', 'Conhecendo o Produto'),
      T('Conhecer diferenças entre Android e iOS', 'Conhecendo o Produto', { materials: [L('Android Developers', 'https://developer.android.com/'), L('Apple Developer', 'https://developer.apple.com/')] }),
      T('Conhecer processo de publicação', 'Conhecendo o Produto'), T('Instalar versão de teste', 'Testes Mobile'),
      T('Validar aplicação em celular Android', 'Testes Mobile', { evidence: true }), T('Validar aplicação em iPhone, quando disponível', 'Testes Mobile', { evidence: true }),
      T('Testar diferentes tamanhos de tela', 'Testes Mobile', { evidence: true }), T('Validar comportamento em dispositivo físico', 'Testes Mobile', { evidence: true }),
      T('Executar checklist de regressão', 'Processo de Qualidade', { evidence: true, materials: [F('Checklist de QA — demo', 'pitang-demo-checklist.txt')] }),
      T('Registrar bugs encontrados', 'Processo de Qualidade', { evidence: true }), T('Validar correções em dispositivo físico', 'Processo de Qualidade', { evidence: true, approval: true }),
    ],
  },
];

const assignmentPlan = [
  ['anne@pitang.demo', 'Cultura e Onboarding Pitang', 3, 'normal'], ['anne@pitang.demo', 'Onboarding Projeto Tramontina', 4, 'normal'],
  ['eduarda@pitang.demo', 'Segurança da Informação', 3, 'normal'], ['eduarda@pitang.demo', 'Onboarding Projeto In Forma', 9, 'submitted'],
  ['diego@pitang.demo', 'Desenvolvimento e Evolução Profissional', 1, 'normal'], ['diego@pitang.demo', 'Onboarding Projeto Tramontina', 2, 'normal'],
  ['jadley@pitang.demo', 'Cultura e Onboarding Pitang', 0, 'normal'], ['jadley@pitang.demo', 'Onboarding Projeto Sola', 9, 'rejected'],
  ['danilo@pitang.demo', 'Segurança da Informação', 0, 'normal'], ['danilo@pitang.demo', 'Onboarding Projeto Sola', 4, 'normal'],
];

async function ensureUser(strapi, roles, [username, email, name, roleType]) {
  const role = roles.get(roleType);
  let user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email } });
  const data = { username, email, name, role: role.id, provider: 'local', confirmed: true, blocked: false, is_active: true };
  if (!user) return strapi.plugin('users-permissions').service('user').add({ ...data, password: DEMO_PASSWORD });
  return user;
}

async function ensureUpload(strapi, asset) {
  const name = `pitang-demo-${asset}`;
  const existing = await strapi.db.query('plugin::upload.file').findOne({ where: { name } });
  if (existing) return existing;
  const filePath = path.resolve(process.cwd(), 'demo-assets', asset);
  const stat = fs.statSync(filePath);
  const uploaded = await strapi.plugin('upload').service('upload').upload({
    data: { fileInfo: { name, caption: 'Material de demonstração do Pitang Booster' } },
    files: {
      filepath: filePath,
      originalFilename: name,
      mimetype: 'text/plain',
      size: stat.size,
    },
  });
  return uploaded[0];
}

async function removeDemoTrackData(strapi, track) {
  const assignments = await strapi.db.query('api::track-assignment.track-assignment').findMany({ where: { track: { id: track.id } } });
  for (const assignment of assignments) {
    const executions = await strapi.db.query('api::task-execution.task-execution').findMany({ where: { track_assignment: { id: assignment.id } } });
    for (const execution of executions) {
      const evidences = await strapi.db.query('api::task-evidence.task-evidence').findMany({ where: { task_execution: { id: execution.id } } });
      for (const evidence of evidences) await strapi.db.query('api::task-evidence.task-evidence').delete({ where: { id: evidence.id } });
      await strapi.db.query('api::task-execution.task-execution').delete({ where: { id: execution.id } });
    }
    await strapi.db.query('api::track-assignment.track-assignment').delete({ where: { id: assignment.id } });
  }
  const versions = await strapi.db.query('api::track-version.track-version').findMany({ where: { track: { id: track.id } } });
  for (const version of versions) await strapi.db.query('api::track-version.track-version').delete({ where: { id: version.id } });
  const tasks = await strapi.db.query('api::task.task').findMany({ where: { track: { id: track.id } } });
  for (const task of tasks) await strapi.db.query('api::task.task').delete({ where: { id: task.id } });
}

async function removeAssignment(strapi, assignment) {
  const executions = await strapi.db.query('api::task-execution.task-execution').findMany({ where: { track_assignment: { id: assignment.id } } });
  for (const execution of executions) {
    const evidences = await strapi.db.query('api::task-evidence.task-evidence').findMany({ where: { task_execution: { id: execution.id } } });
    for (const evidence of evidences) await strapi.db.query('api::task-evidence.task-evidence').delete({ where: { id: evidence.id } });
    await strapi.db.query('api::task-execution.task-execution').delete({ where: { id: execution.id } });
  }
  await strapi.db.query('api::track-assignment.track-assignment').delete({ where: { id: assignment.id } });
}

async function main() {
  const appContext = await compileStrapi();
  const strapi = await createStrapi(appContext).load();
  try {
    console.log(`[seed:demo] etapa: ${stage}`);
    const roleRows = await strapi.db.query('plugin::users-permissions.role').findMany();
    const roles = new Map(roleRows.map((role) => [role.type, role]));
    for (const role of ['admin', 'hr', 'leadership', 'employee']) if (!roles.has(role)) throw new Error(`Role ${role} ausente. Inicie o backend uma vez para executar o bootstrap.`);
    const demoUsers = new Map();
    for (const seed of users) { const user = await ensureUser(strapi, roles, seed); demoUsers.set(seed[1], user); }
    console.log(`[seed:demo] ${demoUsers.size} usuários preparados`);

    const uploads = new Map();
    for (const asset of ['pitang-demo-guia.txt', 'pitang-demo-checklist.txt']) uploads.set(asset, await ensureUpload(strapi, asset));
    console.log(`[seed:demo] ${uploads.size} arquivos preparados`);
    const projects = new Map();
    for (const name of ['Tramontina', 'In Forma', 'Sola']) {
      let project = await strapi.db.query('api::project.project').findOne({ where: { name } });
      if (!project) project = await strapi.service('api::project.project').create({ data: { name, description: `Projeto ${name} — massa de demonstração.`, is_active: true, publishedAt: new Date().toISOString() } });
      projects.set(name, project);
    }
    console.log(`[seed:demo] ${projects.size} projetos preparados`);

    const createdTracks = new Map();
    const shouldSeedTracks = stage === 'all' || stage.startsWith('tracks-');
    const selectedTracks = !shouldSeedTracks
      ? []
      : stage === 'tracks-institutional'
        ? tracks.filter((track) => track.type === 'institutional')
        : stage === 'tracks-projects'
          ? tracks.filter((track) => track.type === 'project')
          : tracks;
    for (const definition of selectedTracks) {
      console.log(`[seed:demo] recriando trilha: ${definition.name}`);
      let track = await strapi.db.query('api::track.track').findOne({ where: { name: definition.name } });
      if (track) await removeDemoTrackData(strapi, track);
      if (!track) track = await strapi.service('api::track.track').create({ data: { name: definition.name, description: definition.description, track_type: definition.type, version: 1, is_active: true, created_by_user: demoUsers.get('maira@pitang.demo').id } });
      else track = await strapi.service('api::track.track').update(track.documentId || track.id, { data: { description: definition.description, track_type: definition.type, version: 1, is_active: true } });
      if (definition.project) await strapi.service('api::project.project').update(projects.get(definition.project).documentId || projects.get(definition.project).id, { data: { tracks: { connect: [track.documentId || track.id] } } });

      const taskRows = [];
      for (let index = 0; index < definition.tasks.length; index += 1) {
        const item = definition.tasks[index];
        const materials = (item.materials || []).map((material, materialIndex) => ({
          title: material.title, description: material.description, material_type: material.material_type,
          order_index: materialIndex + 1, external_url: material.external_url || null,
          file: material.asset ? uploads.get(material.asset).id : null,
        }));
        const task = await strapi.service('api::task.task').create({ data: {
          title: item.title, description: `Fase conceitual: ${item.phase}. ${definition.description}`,
          order_index: index + 1, action_type: item.evidence ? 'upload' : 'reading', is_required: true,
          is_active: true, requires_evidence: item.evidence === true, requires_manual_approval: item.approval === true,
          track: track.id, materials,
        }});
        taskRows.push(task);
        console.log(`[seed:demo]   tarefa ${index + 1}/${definition.tasks.length}: ${item.title}`);
      }
      for (let index = 1; index < taskRows.length; index += 1) {
        await strapi.db.query('api::task.task').update({
          where: { id: taskRows[index].id },
          data: { depends_on: [taskRows[index - 1].id] },
        });
      }
      const latestTrack = await strapi.db.query('api::track.track').findOne({ where: { id: track.id } });
      const { ensureCurrentTrackSnapshot } = require('../dist/src/api/track/services/track-versioning.js');
      await ensureCurrentTrackSnapshot(latestTrack.id, demoUsers.get('maira@pitang.demo').id);
      createdTracks.set(definition.name, latestTrack);
      console.log(`[seed:demo] trilha pronta: ${definition.name}`);
    }

    const shouldSeedAssignments = stage === 'all' || stage.startsWith('assignments-');
    const selectedAssignments = !shouldSeedAssignments
      ? []
      : stage === 'assignments-a'
        ? assignmentPlan.slice(0, 5)
        : stage === 'assignments-b'
          ? assignmentPlan.slice(5)
          : assignmentPlan;
    for (const [email, trackName, completedCount, special] of selectedAssignments) {
      console.log(`[seed:demo] atribuindo ${trackName} para ${email}`);
      let targetTrack = createdTracks.get(trackName);
      if (!targetTrack) targetTrack = await strapi.db.query('api::track.track').findOne({ where: { name: trackName } });
      if (!targetTrack) throw new Error(`Trilha demo ausente: ${trackName}. Execute primeiro as etapas de trilhas.`);
      const existingAssignments = await strapi.db.query('api::track-assignment.track-assignment').findMany({
        where: { track: { id: targetTrack.id }, user: { id: demoUsers.get(email).id } },
      });
      for (const existingAssignment of existingAssignments) await removeAssignment(strapi, existingAssignment);
      const assignment = await strapi.service('api::track-assignment.track-assignment').assignTrackToUser({
        data: { track: targetTrack.id, user: demoUsers.get(email).id },
        assignedByUserId: demoUsers.get('maira@pitang.demo').id,
      });
      const executions = await strapi.db.query('api::task-execution.task-execution').findMany({ where: { track_assignment: { id: assignment.id } }, orderBy: { id: 'asc' } });
      const { releaseDependentExecutions } = require('../dist/src/api/task-execution/services/dependency-release.js');
      // 'submitted'/'rejected' only make sense on the task that actually requires manual approval,
      // so locate it instead of trusting completedCount to line up with it.
      const approvalIndex = executions.findIndex((execution) => execution.task_snapshot?.requiresManualApproval === true);
      if (special !== 'normal' && approvalIndex === -1) {
        throw new Error(`Trilha ${trackName} nao possui tarefa com aprovacao manual para o cenario '${special}'`);
      }
      const completeUpTo = special === 'normal' ? Math.min(completedCount, executions.length) : approvalIndex;
      for (let index = 0; index < completeUpTo; index += 1) {
        await strapi.db.query('api::task-execution.task-execution').update({ where: { id: executions[index].id }, data: { execution_status: 'completed', validation_status: 'approved', completed_at: new Date().toISOString() } });
        await releaseDependentExecutions(assignment.id);
      }
      const current = special === 'normal'
        ? executions[Math.min(completedCount, executions.length - 1)]
        : executions[approvalIndex];
      if (current && special !== 'normal') {
        await strapi.db.query('api::task-execution.task-execution').update({ where: { id: current.id }, data: { execution_status: special, validation_status: special === 'rejected' ? 'rejected' : 'pending', review_feedback: special === 'rejected' ? 'Revise a evidência e inclua os resultados do teste.' : null } });
        await strapi.db.query('api::task-evidence.task-evidence').create({ data: { task_execution: current.id, evidence_type: 'link', external_url: 'https://github.com/pitanglabs', submitted_by: demoUsers.get(email).id, notes: 'Evidência de demonstração.' } });
      }
      await strapi.service('api::task-execution.task-execution').syncTrackAssignmentProgress(assignment.id);
    }

    const counts = { users: users.length, projects: projects.size, tracks: selectedTracks.length, phases: 0, tasks: selectedTracks.reduce((sum, track) => sum + track.tasks.length, 0), assignments: selectedAssignments.length };
    console.log(`\nEtapa ${stage} concluída:`, counts);
    console.log(`Credenciais: *@pitang.demo / ${DEMO_PASSWORD}`);
    console.log('Observação: fases são agrupamentos conceituais; o modelo não possui entidade Phase.');
  } finally {
    await strapi.destroy();
  }
}

main().catch((error) => { console.error('Falha ao executar seed demo:', error); process.exitCode = 1; });
