import process from 'node:process';

const config = {
  baseUrl: process.env.STRAPI_BASE_URL ?? 'http://localhost:1337/api',
  adminEmail: process.env.STRAPI_ADMIN_EMAIL ?? 'admin@pitango.local',
  adminPassword: process.env.STRAPI_ADMIN_PASSWORD ?? 'Admin@123',
  employeeEmail: process.env.STRAPI_EMPLOYEE_EMAIL ?? 'employee@pitango.local',
  employeePassword: process.env.STRAPI_EMPLOYEE_PASSWORD ?? 'Employee@123',
};

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

const names = {
  project: `Projeto E7 ${timestamp}`,
  track: `Trilha E7 ${timestamp}`,
  task1: `Tarefa 1 E7 ${timestamp}`,
  task2: `Tarefa 2 E7 ${timestamp}`,
  task3: `Tarefa 3 E7 aprovacao manual ${timestamp}`,
};

const summary = {
  adminUserId: null,
  employeeUserId: null,
  projectId: null,
  trackId: null,
  taskIds: [],
  trackAssignmentId: null,
  taskExecutionIds: [],
  progressAfterFirstCompletion: null,
  progressAfterSecondCompletion: null,
  progressAfterManualSubmission: null,
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
  const url = `${config.baseUrl}${path}`;
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    const cause = error instanceof Error && error.cause ? `\n${String(error.cause)}` : '';

    fail(`Falha ao chamar ${url}${cause}`);
  }

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

const createProject = async (token) => {
  const result = await request('/projects', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      data: {
        name: names.project,
        description: 'Projeto criado automaticamente para validar o Encontro 7.',
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

const createTrack = async (token, projectId) => {
  const result = await request('/tracks', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      data: {
        name: names.track,
        description: 'Trilha criada automaticamente para validar o Encontro 7.',
        track_type: 'project',
        version: 1,
        is_active: true,
        projects: [projectId],
      },
    }),
  });

  const body = expectSuccess(result, 'Criacao da trilha');
  const trackId = body?.data?.id;

  if (!trackId) {
    fail('Criacao da trilha nao retornou id');
  }

  summary.trackId = trackId;
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

const ensureEmployee = async (token) => {
  const users = await listUsers(token);
  const user = users.find((item) => item.email === config.employeeEmail);

  if (!user) {
    fail(`Usuario employee nao encontrado: ${config.employeeEmail}`);
  }

  summary.employeeUserId = user.id;
  return user;
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

  if (status !== 'not_started') {
    fail(`Track assignment retornou status inicial inesperado: ${status}`);
  }

  summary.trackAssignmentId = assignmentId;
  return assignmentId;
};

const listAssignmentTasks = async (token, assignmentId) => {
  const result = await request(`/my-track-assignments/${assignmentId}/tasks`, {
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Listagem de task executions da atribuicao');
  const items = body?.data ?? [];

  if (!Array.isArray(items)) {
    fail('Listagem de task executions nao retornou um array');
  }

  return items;
};

const getMyAssignments = async (token) => {
  const result = await request('/my-track-assignments?populate=track', {
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Listagem de minhas trilhas');
  const items = body?.data ?? [];

  if (!Array.isArray(items)) {
    fail('Listagem de minhas trilhas nao retornou um array');
  }

  return items;
};

const completeExecution = async (token, executionId) => {
  const result = await request(`/task-executions/${executionId}/complete`, {
    method: 'POST',
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Conclusao de task execution');

  if (body?.data?.execution_status !== 'completed') {
    fail(`Task execution nao retornou completed apos conclusao\n${JSON.stringify(body, null, 2)}`);
  }

  return body;
};

const expectCompleteBlockedExecutionToFail = async (token, executionId) => {
  const result = await request(`/task-executions/${executionId}/complete`, {
    method: 'POST',
    headers: authHeaders(token),
  });

  const body = result.body;

  if (result.response.status !== 400) {
    fail(
      `Conclusao de task execution bloqueada deveria falhar com 400, retornou ${result.response.status}\n${JSON.stringify(body, null, 2)}`
    );
  }

  const message = body?.error?.message ?? '';

  if (!String(message).includes('Tarefa ainda nao pode ser concluida')) {
    fail(`Mensagem inesperada ao concluir tarefa bloqueada\n${JSON.stringify(body, null, 2)}`);
  }

  return body;
};

const submitExecutionForApproval = async (token, executionId) => {
  const result = await request(`/task-executions/${executionId}/complete`, {
    method: 'POST',
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Submissao de task execution para aprovacao');

  if (body?.data?.execution_status !== 'submitted') {
    fail(`Task execution manual nao retornou submitted\n${JSON.stringify(body, null, 2)}`);
  }

  if (body?.data?.validation_status !== 'pending') {
    fail(`Task execution manual nao ficou pending\n${JSON.stringify(body, null, 2)}`);
  }

  return body;
};

const assertInitialExecutions = (items) => {
  if (items.length !== 3) {
    fail(`Esperava 3 task executions, recebi ${items.length}`);
  }

  const ordered = [...items].sort(
    (left, right) => (left.task?.order_index ?? 0) - (right.task?.order_index ?? 0)
  );

  const [first, second, third] = ordered;

  if (first.execution_status !== 'available') {
    fail(`Primeira task execution deveria iniciar como available, veio ${first.execution_status}`);
  }

  if (second.execution_status !== 'locked') {
    fail(`Segunda task execution deveria iniciar como locked, veio ${second.execution_status}`);
  }

  if (third.execution_status !== 'locked') {
    fail(`Terceira task execution deveria iniciar como locked, veio ${third.execution_status}`);
  }

  summary.taskExecutionIds = ordered.map((item) => item.id);

  return { first, second, third };
};

const assertAssignmentProgress = (items, expectedAssignmentId, expectedStatus, expectedProgress) => {
  const assignment = items.find((item) => item.id === expectedAssignmentId);

  if (!assignment) {
    fail('Track assignment nao apareceu em /my-track-assignments');
  }

  if (assignment.status !== expectedStatus) {
    fail(`Status inesperado da atribuicao: esperado ${expectedStatus}, veio ${assignment.status}`);
  }

  const progress = Number(assignment.progress_percentage ?? 0);

  if (progress !== expectedProgress) {
    fail(`Progresso inesperado da atribuicao: esperado ${expectedProgress}, veio ${progress}`);
  }

  return assignment;
};

const run = async () => {
  print('Validando Encontro 7');

  const adminLogin = await login(config.adminEmail, config.adminPassword, 'admin');
  summary.adminUserId = adminLogin.user.id;
  print(`Admin autenticado: ${config.adminEmail}`);

  const employee = await ensureEmployee(adminLogin.jwt);
  print(`Employee conferido: ${employee.email}`);

  const projectId = await createProject(adminLogin.jwt);
  print(`Projeto criado: ${projectId}`);

  const trackId = await createTrack(adminLogin.jwt, projectId);
  print(`Trilha criada: ${trackId}`);

  const task1 = await createTask(
    adminLogin.jwt,
    {
      title: names.task1,
      description: 'Primeira tarefa para validar progresso no Encontro 7.',
      order_index: 1,
      is_required: true,
      requires_evidence: false,
      requires_manual_approval: false,
      action_type: 'reading',
      is_active: true,
      track: trackId,
    },
    'Criacao da tarefa 1'
  );

  const task2 = await createTask(
    adminLogin.jwt,
    {
      title: names.task2,
      description: 'Segunda tarefa dependente da primeira.',
      order_index: 2,
      is_required: true,
      requires_evidence: false,
      requires_manual_approval: false,
      action_type: 'form',
      is_active: true,
      track: trackId,
      depends_on: [task1],
    },
    'Criacao da tarefa 2'
  );

  const task3 = await createTask(
    adminLogin.jwt,
    {
      title: names.task3,
      description: 'Terceira tarefa exige aprovacao manual antes de contar progresso.',
      order_index: 3,
      is_required: true,
      requires_evidence: true,
      requires_manual_approval: true,
      action_type: 'upload',
      is_active: true,
      track: trackId,
      depends_on: [task2],
    },
    'Criacao da tarefa 3 com aprovacao manual'
  );

  summary.taskIds = [task1, task2, task3];
  print(`Tarefas criadas: ${summary.taskIds.join(', ')}`);

  const assignmentId = await createTrackAssignment(adminLogin.jwt, trackId, employee.id);
  print(`Track assignment criado: ${assignmentId}`);

  const employeeLogin = await login(config.employeeEmail, config.employeePassword, 'employee');
  const initialExecutions = await listAssignmentTasks(employeeLogin.jwt, assignmentId);
  const { first, second, third } = assertInitialExecutions(initialExecutions);
  print('Task executions iniciais validados');

  await expectCompleteBlockedExecutionToFail(employeeLogin.jwt, second.id);
  print('Bloqueio de task execution dependente validado');

  await completeExecution(employeeLogin.jwt, first.id);
  print(`Primeira task execution concluida: ${first.id}`);

  const assignmentsAfterFirst = await getMyAssignments(employeeLogin.jwt);
  const assignmentAfterFirst = assertAssignmentProgress(
    assignmentsAfterFirst,
    assignmentId,
    'in_progress',
    33.33
  );
  summary.progressAfterFirstCompletion = Number(assignmentAfterFirst.progress_percentage ?? 0);

  const afterFirstExecutions = await listAssignmentTasks(employeeLogin.jwt, assignmentId);
  const unlockedExecution = afterFirstExecutions.find((item) => item.id === second.id);

  if (!unlockedExecution) {
    fail('Segunda task execution nao foi encontrada apos a primeira conclusao');
  }

  if (unlockedExecution.execution_status !== 'available') {
    fail(
      `Segunda task execution deveria ser liberada como available, veio ${unlockedExecution.execution_status}`
    );
  }

  print(`Segunda task execution liberada: ${unlockedExecution.id}`);

  await completeExecution(employeeLogin.jwt, unlockedExecution.id);
  print(`Segunda task execution concluida: ${unlockedExecution.id}`);

  const assignmentsAfterSecond = await getMyAssignments(employeeLogin.jwt);
  const assignmentAfterSecond = assertAssignmentProgress(
    assignmentsAfterSecond,
    assignmentId,
    'in_progress',
    66.67
  );
  summary.progressAfterSecondCompletion = Number(assignmentAfterSecond.progress_percentage ?? 0);

  const afterSecondExecutions = await listAssignmentTasks(employeeLogin.jwt, assignmentId);
  const manualExecution = afterSecondExecutions.find((item) => item.id === third.id);

  if (!manualExecution) {
    fail('Terceira task execution manual nao foi encontrada apos a segunda conclusao');
  }

  if (manualExecution.execution_status !== 'available') {
    fail(
      `Terceira task execution deveria ser liberada como available, veio ${manualExecution.execution_status}`
    );
  }

  await submitExecutionForApproval(employeeLogin.jwt, manualExecution.id);
  print(`Terceira task execution enviada para aprovacao: ${manualExecution.id}`);

  const assignmentsAfterManualSubmission = await getMyAssignments(employeeLogin.jwt);
  const assignmentAfterManualSubmission = assertAssignmentProgress(
    assignmentsAfterManualSubmission,
    assignmentId,
    'in_progress',
    66.67
  );
  summary.progressAfterManualSubmission = Number(
    assignmentAfterManualSubmission.progress_percentage ?? 0
  );

  print('Encontro 7 validado com sucesso');
  print(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  fail(`Execucao interrompida\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});
