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
  project: `Projeto E2E ${timestamp}`,
  track: `Trilha E2E ${timestamp}`,
  otherTrack: `Trilha E2E invalida ${timestamp}`,
  task1: `E2E tarefa inicial ${timestamp}`,
  task2: `E2E tarefa dependente ${timestamp}`,
  task3: `E2E tarefa manual ${timestamp}`,
  otherTask: `E2E tarefa outra trilha ${timestamp}`,
  invalidTask: `E2E dependencia invalida ${timestamp}`,
};

const summary = {
  projectId: null,
  trackId: null,
  otherTrackId: null,
  taskIds: [],
  assignmentId: null,
  executionIds: [],
  negativeChecks: [],
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

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

const expectSuccess = (result, context) => {
  if (result.response.ok) {
    return result.body;
  }

  fail(`${context} falhou com status ${result.response.status}\n${JSON.stringify(result.body, null, 2)}`);
};

const expectStatus = (result, expectedStatus, context, expectedMessagePart) => {
  if (result.response.status !== expectedStatus) {
    fail(
      `${context} retornou ${result.response.status} em vez de ${expectedStatus}\n${JSON.stringify(result.body, null, 2)}`
    );
  }

  if (expectedMessagePart) {
    const message = result.body?.error?.message ?? '';

    if (!String(message).includes(expectedMessagePart)) {
      fail(`${context} retornou mensagem inesperada\n${JSON.stringify(result.body, null, 2)}`);
    }
  }

  summary.negativeChecks.push(context);
  return result.body;
};

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

const expectInvalidLogin = async () => {
  const result = await request('/auth/local', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      identifier: config.employeeEmail,
      password: `senha-errada-${timestamp}`,
    }),
  });

  expectStatus(result, 400, 'Login invalido deve falhar');
};

const expectMeWithoutTokenToFail = async () => {
  const result = await request('/me');

  expectStatus(result, 403, '/me sem token deve falhar');
};

const createProject = async (token) => {
  const result = await request('/projects', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      data: {
        name: names.project,
        description: 'Projeto criado pelo teste ponta a ponta.',
        is_active: true,
      },
    }),
  });

  const body = expectSuccess(result, 'Criacao de projeto');
  const id = body?.data?.id;

  if (!id) {
    fail('Criacao de projeto nao retornou id');
  }

  summary.projectId = id;
  return id;
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
  const id = body?.data?.id;

  if (!id) {
    fail(`${context} nao retornou id`);
  }

  return id;
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
  const id = body?.data?.id;

  if (!id) {
    fail(`${context} nao retornou id`);
  }

  return id;
};

const expectInvalidDependencyToFail = async (token, payload) => {
  const result = await request('/tasks', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      data: payload,
    }),
  });

  expectStatus(
    result,
    400,
    'Criacao de task com dependencia de outra trilha deve falhar',
    'Dependencias devem pertencer a mesma trilha'
  );
};

const listUsers = async (token) => {
  const result = await request('/users', {
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Listagem de usuarios');

  if (!Array.isArray(body)) {
    fail('Listagem de usuarios nao retornou array');
  }

  return body;
};

const ensureEmployee = async (token) => {
  const users = await listUsers(token);
  const employee = users.find((user) => user.email === config.employeeEmail);

  if (!employee) {
    fail(`Usuario employee nao encontrado: ${config.employeeEmail}`);
  }

  return employee;
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

  const body = expectSuccess(result, 'Criacao de atribuicao de trilha');
  const id = body?.data?.id;

  if (!id) {
    fail('Criacao de atribuicao nao retornou id');
  }

  summary.assignmentId = id;
  return id;
};

const expectEmployeeCannotCreateAssignment = async (token, trackId, userId) => {
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

  expectStatus(result, 403, 'Employee tentando criar atribuicao deve falhar');
};

const listAssignmentTasks = async (token, assignmentId) => {
  const result = await request(`/my-track-assignments/${assignmentId}/tasks`, {
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Listagem de execucoes da atribuicao');
  const items = body?.data ?? [];

  if (!Array.isArray(items)) {
    fail('Listagem de execucoes nao retornou array');
  }

  return items;
};

const expectAdminCannotListEmployeeAssignmentTasks = async (token, assignmentId) => {
  const result = await request(`/my-track-assignments/${assignmentId}/tasks`, {
    headers: authHeaders(token),
  });

  expectStatus(result, 403, 'Admin acessando endpoint minhas tarefas do employee deve falhar');
};

const getMyAssignments = async (token) => {
  const result = await request('/my-track-assignments?populate=track', {
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Listagem de minhas trilhas');
  const items = body?.data ?? [];

  if (!Array.isArray(items)) {
    fail('Listagem de minhas trilhas nao retornou array');
  }

  return items;
};

const completeExecution = async (token, executionId, expectedStatus) => {
  const result = await request(`/task-executions/${executionId}/complete`, {
    method: 'POST',
    headers: authHeaders(token),
  });

  const body = expectSuccess(result, 'Conclusao/submissao de task execution');

  if (body?.data?.execution_status !== expectedStatus) {
    fail(
      `Task execution deveria retornar ${expectedStatus}, veio ${body?.data?.execution_status}\n${JSON.stringify(body, null, 2)}`
    );
  }

  return body;
};

const expectCompleteExecutionToFail = async (token, executionId, context, expectedStatus, message) => {
  const result = await request(`/task-executions/${executionId}/complete`, {
    method: 'POST',
    headers: authHeaders(token),
  });

  expectStatus(result, expectedStatus, context, message);
};

const assertProgress = (items, assignmentId, expectedStatus, expectedProgress) => {
  const assignment = items.find((item) => item.id === assignmentId);

  if (!assignment) {
    fail('Atribuicao criada nao apareceu em /my-track-assignments');
  }

  if (assignment.status !== expectedStatus) {
    fail(`Status esperado ${expectedStatus}, veio ${assignment.status}`);
  }

  const progress = Number(assignment.progress_percentage ?? 0);

  if (progress !== expectedProgress) {
    fail(`Progresso esperado ${expectedProgress}, veio ${progress}`);
  }

  return assignment;
};

const assertInitialExecutions = (items) => {
  if (items.length !== 3) {
    fail(`Esperava 3 execucoes iniciais, recebi ${items.length}`);
  }

  const ordered = [...items].sort(
    (left, right) => (left.task?.order_index ?? 0) - (right.task?.order_index ?? 0)
  );
  const [first, second, third] = ordered;

  if (first.execution_status !== 'available') {
    fail(`Primeira execucao deveria iniciar available, veio ${first.execution_status}`);
  }

  if (second.execution_status !== 'locked') {
    fail(`Segunda execucao deveria iniciar locked, veio ${second.execution_status}`);
  }

  if (third.execution_status !== 'locked') {
    fail(`Terceira execucao deveria iniciar locked, veio ${third.execution_status}`);
  }

  summary.executionIds = ordered.map((item) => item.id);
  return { first, second, third };
};

const run = async () => {
  print('Validando fluxo ponta a ponta');

  await expectInvalidLogin();
  print('Login invalido bloqueado');

  await expectMeWithoutTokenToFail();
  print('/me sem token bloqueado');

  const adminLogin = await login(config.adminEmail, config.adminPassword, 'admin');
  const employeeLogin = await login(config.employeeEmail, config.employeePassword, 'employee');
  const employee = await ensureEmployee(adminLogin.jwt);
  print('Usuarios autenticados');

  const projectId = await createProject(adminLogin.jwt);
  const trackId = await createTrack(
    adminLogin.jwt,
    {
      name: names.track,
      description: 'Trilha criada pelo teste ponta a ponta.',
      track_type: 'project',
      version: 1,
      is_active: true,
      projects: [projectId],
    },
    'Criacao da trilha principal'
  );
  const otherTrackId = await createTrack(
    adminLogin.jwt,
    {
      name: names.otherTrack,
      description: 'Trilha usada para validar dependencia invalida.',
      track_type: 'project',
      version: 1,
      is_active: true,
      projects: [projectId],
    },
    'Criacao da trilha auxiliar'
  );

  summary.trackId = trackId;
  summary.otherTrackId = otherTrackId;
  print(`Projeto e trilhas criados: ${projectId}, ${trackId}, ${otherTrackId}`);

  const task1 = await createTask(
    adminLogin.jwt,
    {
      title: names.task1,
      description: 'Tarefa inicial do fluxo ponta a ponta.',
      order_index: 1,
      is_required: true,
      requires_evidence: false,
      requires_manual_approval: false,
      action_type: 'reading',
      is_active: true,
      track: trackId,
    },
    'Criacao da task inicial'
  );
  const task2 = await createTask(
    adminLogin.jwt,
    {
      title: names.task2,
      description: 'Tarefa dependente da task inicial.',
      order_index: 2,
      is_required: true,
      requires_evidence: false,
      requires_manual_approval: false,
      action_type: 'form',
      is_active: true,
      track: trackId,
      depends_on: [task1],
    },
    'Criacao da task dependente'
  );
  const task3 = await createTask(
    adminLogin.jwt,
    {
      title: names.task3,
      description: 'Tarefa que exige aprovacao manual.',
      order_index: 3,
      is_required: true,
      requires_evidence: true,
      requires_manual_approval: true,
      action_type: 'upload',
      is_active: true,
      track: trackId,
      depends_on: [task2],
    },
    'Criacao da task manual'
  );
  const otherTask = await createTask(
    adminLogin.jwt,
    {
      title: names.otherTask,
      description: 'Tarefa criada em outra trilha.',
      order_index: 1,
      is_required: true,
      action_type: 'reading',
      is_active: true,
      track: otherTrackId,
    },
    'Criacao da task auxiliar'
  );

  summary.taskIds = [task1, task2, task3, otherTask];
  print(`Tasks criadas: ${summary.taskIds.join(', ')}`);

  await expectInvalidDependencyToFail(adminLogin.jwt, {
    title: names.invalidTask,
    description: 'Deve falhar porque a dependencia esta em outra trilha.',
    order_index: 4,
    is_required: true,
    action_type: 'reading',
    is_active: true,
    track: trackId,
    depends_on: [otherTask],
  });
  print('Dependencia invalida bloqueada');

  await expectEmployeeCannotCreateAssignment(employeeLogin.jwt, trackId, employee.id);
  print('Employee sem permissao para criar atribuicao');

  const assignmentId = await createTrackAssignment(adminLogin.jwt, trackId, employee.id);
  print(`Atribuicao criada: ${assignmentId}`);

  await expectAdminCannotListEmployeeAssignmentTasks(adminLogin.jwt, assignmentId);
  print('Admin bloqueado no endpoint de minhas tarefas do employee');

  const initialExecutions = await listAssignmentTasks(employeeLogin.jwt, assignmentId);
  const { first, second, third } = assertInitialExecutions(initialExecutions);
  print('Execucoes iniciais validadas');

  await expectCompleteExecutionToFail(
    employeeLogin.jwt,
    second.id,
    'Employee tentando concluir task bloqueada deve falhar',
    400,
    'Tarefa ainda nao pode ser concluida'
  );
  print('Conclusao de task bloqueada rejeitada');

  await expectCompleteExecutionToFail(
    adminLogin.jwt,
    first.id,
    'Admin tentando concluir execution do employee deve falhar',
    403,
    'Usuario sem acesso a esta tarefa'
  );
  print('Conclusao por usuario errado rejeitada');

  await completeExecution(employeeLogin.jwt, first.id, 'completed');
  const assignmentsAfterFirst = await getMyAssignments(employeeLogin.jwt);
  assertProgress(assignmentsAfterFirst, assignmentId, 'in_progress', 33.33);
  print('Primeira task concluida e progresso validado');

  const afterFirstExecutions = await listAssignmentTasks(employeeLogin.jwt, assignmentId);
  const secondExecution = afterFirstExecutions.find((item) => item.id === second.id);

  if (secondExecution?.execution_status !== 'available') {
    fail(`Segunda execucao deveria estar available, veio ${secondExecution?.execution_status}`);
  }

  await completeExecution(employeeLogin.jwt, second.id, 'completed');
  const assignmentsAfterSecond = await getMyAssignments(employeeLogin.jwt);
  assertProgress(assignmentsAfterSecond, assignmentId, 'in_progress', 66.67);
  print('Segunda task concluida e progresso validado');

  const afterSecondExecutions = await listAssignmentTasks(employeeLogin.jwt, assignmentId);
  const thirdExecution = afterSecondExecutions.find((item) => item.id === third.id);

  if (thirdExecution?.execution_status !== 'available') {
    fail(`Terceira execucao deveria estar available, veio ${thirdExecution?.execution_status}`);
  }

  await completeExecution(employeeLogin.jwt, third.id, 'submitted');
  const assignmentsAfterManualSubmit = await getMyAssignments(employeeLogin.jwt);
  assertProgress(assignmentsAfterManualSubmit, assignmentId, 'in_progress', 66.67);
  print('Task manual enviada para aprovacao sem fechar progresso');

  await expectCompleteExecutionToFail(
    employeeLogin.jwt,
    third.id,
    'Reenvio de task manual submitted deve falhar',
    400,
    'Tarefa ainda nao pode ser concluida'
  );
  print('Reenvio de task manual rejeitado');

  print('Validacao ponta a ponta concluida com sucesso');
  print(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  fail(`Execucao interrompida\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});
