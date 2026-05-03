import process from 'node:process';

const config = {
  baseUrl: process.env.STRAPI_BASE_URL ?? 'http://localhost:10000/api',
  adminEmail: process.env.STRAPI_ADMIN_EMAIL ?? 'admin@pitango.local',
  adminPassword: process.env.STRAPI_ADMIN_PASSWORD ?? 'Admin@123',
  employeeEmail: process.env.STRAPI_EMPLOYEE_EMAIL ?? 'employee@pitango.local',
  employeePassword: process.env.STRAPI_EMPLOYEE_PASSWORD ?? 'Employee@123',
};

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

const names = {
  project: `Projeto E6 ${timestamp}`,
  institutionalTrack: `Trilha Institucional E6 ${timestamp}`,
  projectTrack: `Trilha Projeto E6 ${timestamp}`,
  institutionalTask1: `Ler manual institucional ${timestamp}`,
  institutionalTask2: `Configurar ferramentas ${timestamp}`,
  projectTask1: `Ler documentacao do projeto ${timestamp}`,
  projectTask2: `Configurar acessos do projeto ${timestamp}`,
  invalidTask: `Dependencia invalida ${timestamp}`,
};

const summary = {
  roles: {},
  adminUserId: null,
  employeeUserId: null,
  projectId: null,
  institutionalTrackId: null,
  projectTrackId: null,
  institutionalTaskIds: [],
  projectTaskIds: [],
  trackAssignmentId: null,
};

const print = (message) => {
  process.stdout.write(`${message}\n`);
};

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const parseJson = async (response) => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const request = async (path, options = {}) => {
  const response = await fetch(`${config.baseUrl}${path}`, options);
  const body = await parseJson(response);

  return {
    response,
    body,
  };
};

const expectSuccess = (result, context) => {
  if (result.response.ok) {
    return result.body;
  }

  fail(`${context} falhou com status ${result.response.status}\n${JSON.stringify(result.body, null, 2)}`);
};

const expectStatus = (result, expectedStatus, context) => {
  if (result.response.status === expectedStatus) {
    return result.body;
  }

  fail(
    `${context} retornou ${result.response.status} em vez de ${expectedStatus}\n${JSON.stringify(result.body, null, 2)}`
  );
};

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

const login = async (identifier, password, label) => {
  const result = await request('/auth/local', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      identifier,
      password,
    }),
  });

  const body = expectSuccess(result, `Login ${label}`);

  if (!body?.jwt || !body?.user?.id) {
    fail(`Login ${label} nao retornou jwt ou usuario valido`);
  }

  return body;
};

const listRoles = async (token) => {
  const result = await request('/users-permissions/roles', {
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Listagem de roles');
  const roles = body?.roles ?? [];

  const roleMap = new Map();

  for (const role of roles) {
    roleMap.set(role.type, role);
    summary.roles[role.type] = role.id;
  }

  for (const requiredRole of ['admin', 'hr', 'leadership', 'employee']) {
    if (!roleMap.has(requiredRole)) {
      fail(`Role obrigatoria ausente: ${requiredRole}`);
    }
  }

  return roleMap;
};

const listUsers = async (token) => {
  const result = await request('/users', {
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Listagem de usuarios');

  if (!Array.isArray(body)) {
    fail('Listagem de usuarios nao retornou um array');
  }

  return body;
};

const createUser = async (token, roleId, { username, email, password }) => {
  const result = await request('/users', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      username,
      email,
      password,
      role: roleId,
    }),
  });

  return expectSuccess(result, `Criacao do usuario ${email}`);
};

const ensureEmployee = async (token, employeeRoleId) => {
  const users = await listUsers(token);
  const existingUser = users.find((user) => user.email === config.employeeEmail);

  if (existingUser) {
    summary.employeeUserId = existingUser.id;
    return existingUser;
  }

  const createdUser = await createUser(token, employeeRoleId, {
    username: `employee.e6.${timestamp}`.toLowerCase(),
    email: config.employeeEmail,
    password: config.employeePassword,
  });

  summary.employeeUserId = createdUser.id;
  return createdUser;
};

const createProject = async (token) => {
  const result = await request('/projects', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      data: {
        name: names.project,
        description: 'Projeto criado automaticamente para validar o Encontro 6.',
        is_active: true,
      },
    }),
  });

  const body = expectSuccess(result, 'Criacao do projeto');
  const projectId = body?.data?.id;

  if (!projectId) {
    fail('Criacao do projeto nao retornou id');
  }

  summary.projectId = projectId;
  return projectId;
};

const createTrack = async (token, payload, context) => {
  const result = await request('/tracks', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      data: payload,
    }),
  });

  const body = expectSuccess(result, context);
  const trackId = body?.data?.id;

  if (!trackId) {
    fail(`${context} nao retornou id`);
  }

  return trackId;
};

const createTask = async (token, payload, context) => {
  const result = await request('/tasks', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      data: payload,
    }),
  });

  const body = expectSuccess(result, context);
  const taskId = body?.data?.id;

  if (!taskId) {
    fail(`${context} nao retornou id`);
  }

  return taskId;
};

const expectInvalidDependency = async (token, payload) => {
  const result = await request('/tasks', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      data: payload,
    }),
  });

  const body = expectStatus(result, 400, 'Validacao de dependencia invalida');
  const message = body?.error?.message ?? '';

  if (!String(message).includes('Dependencias devem pertencer a mesma trilha')) {
    fail(`Mensagem inesperada para dependencia invalida\n${JSON.stringify(body, null, 2)}`);
  }
};

const createTrackAssignment = async (token, trackId, userId) => {
  const result = await request('/track-assignments', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      data: {
        track: trackId,
        user: userId,
      },
    }),
  });

  const body = expectSuccess(result, 'Criacao de track assignment');
  const assignmentId = body?.data?.id;
  const status = body?.data?.status;

  if (!assignmentId) {
    fail('Criacao de track assignment nao retornou id');
  }

  if (status !== 'assigned') {
    fail(`Track assignment retornou status inesperado: ${status}`);
  }

  summary.trackAssignmentId = assignmentId;
  return assignmentId;
};

const listMyAssignments = async (token) => {
  const result = await request('/my-track-assignments?populate=track', {
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Listagem de minhas trilhas');
  const items = body?.data ?? [];

  if (!Array.isArray(items)) {
    fail('Minha listagem de trilhas nao retornou array');
  }

  const assignment = items.find((item) => item.id === summary.trackAssignmentId);

  if (!assignment) {
    fail('Track assignment criado nao apareceu em /my-track-assignments');
  }
};

const run = async () => {
  print('Validando Encontro 6');

  const adminLogin = await login(config.adminEmail, config.adminPassword, 'admin');
  summary.adminUserId = adminLogin.user.id;

  print(`Admin autenticado: ${config.adminEmail}`);

  const roles = await listRoles(adminLogin.jwt);
  print('Roles conferidas');

  const employeeUser = await ensureEmployee(adminLogin.jwt, roles.get('employee').id);
  summary.employeeUserId = employeeUser.id;
  print(`Employee conferido: ${employeeUser.email}`);

  const projectId = await createProject(adminLogin.jwt);
  print(`Projeto criado: ${projectId}`);

  const institutionalTrackId = await createTrack(
    adminLogin.jwt,
    {
      name: names.institutionalTrack,
      description: 'Trilha institucional criada automaticamente para validar o Encontro 6.',
      track_type: 'institutional',
      version: 1,
      is_active: true,
    },
    'Criacao da trilha institucional'
  );

  summary.institutionalTrackId = institutionalTrackId;
  print(`Trilha institucional criada: ${institutionalTrackId}`);

  const projectTrackId = await createTrack(
    adminLogin.jwt,
    {
      name: names.projectTrack,
      description: 'Trilha de projeto criada automaticamente para validar o Encontro 6.',
      track_type: 'project',
      version: 1,
      is_active: true,
      projects: [projectId],
    },
    'Criacao da trilha de projeto'
  );

  summary.projectTrackId = projectTrackId;
  print(`Trilha de projeto criada: ${projectTrackId}`);

  const institutionalTask1 = await createTask(
    adminLogin.jwt,
    {
      title: names.institutionalTask1,
      description: 'Primeira tarefa institucional para validar o Encontro 6.',
      order_index: 1,
      is_required: true,
      requires_evidence: false,
      requires_manual_approval: false,
      action_type: 'reading',
      is_active: true,
      track: institutionalTrackId,
    },
    'Criacao da tarefa institucional 1'
  );

  const institutionalTask2 = await createTask(
    adminLogin.jwt,
    {
      title: names.institutionalTask2,
      description: 'Segunda tarefa institucional para validar o Encontro 6.',
      order_index: 2,
      is_required: true,
      requires_evidence: false,
      requires_manual_approval: false,
      action_type: 'form',
      is_active: true,
      track: institutionalTrackId,
    },
    'Criacao da tarefa institucional 2'
  );

  summary.institutionalTaskIds = [institutionalTask1, institutionalTask2];
  print(`Tarefas institucionais criadas: ${summary.institutionalTaskIds.join(', ')}`);

  const projectTask1 = await createTask(
    adminLogin.jwt,
    {
      title: names.projectTask1,
      description: 'Primeira tarefa do projeto para validar o Encontro 6.',
      order_index: 1,
      is_required: true,
      requires_evidence: false,
      requires_manual_approval: false,
      action_type: 'reading',
      is_active: true,
      track: projectTrackId,
    },
    'Criacao da tarefa de projeto 1'
  );

  const projectTask2 = await createTask(
    adminLogin.jwt,
    {
      title: names.projectTask2,
      description: 'Segunda tarefa do projeto com dependencia valida.',
      order_index: 2,
      is_required: true,
      requires_evidence: false,
      requires_manual_approval: false,
      action_type: 'form',
      is_active: true,
      track: projectTrackId,
      depends_on: [projectTask1],
    },
    'Criacao da tarefa de projeto 2'
  );

  summary.projectTaskIds = [projectTask1, projectTask2];
  print(`Tarefas de projeto criadas: ${summary.projectTaskIds.join(', ')}`);

  await expectInvalidDependency(adminLogin.jwt, {
    title: names.invalidTask,
    description: 'Tarefa que deve falhar por depender de outra trilha.',
    order_index: 3,
    is_required: true,
    requires_evidence: false,
    requires_manual_approval: false,
    action_type: 'reading',
    is_active: true,
    track: institutionalTrackId,
    depends_on: [projectTask1],
  });

  print('Dependencia invalida bloqueada corretamente');

  await createTrackAssignment(adminLogin.jwt, institutionalTrackId, employeeUser.id);
  print(`Track assignment criado: ${summary.trackAssignmentId}`);

  const employeeLogin = await login(config.employeeEmail, config.employeePassword, 'employee');
  await listMyAssignments(employeeLogin.jwt);
  print('Employee visualizou a propria trilha atribuida');

  print('Encontro 6 validado com sucesso');
  print(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  fail(`Execucao interrompida\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});
