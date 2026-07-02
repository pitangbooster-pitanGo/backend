import { readFile } from 'node:fs/promises';
import process from 'node:process';

const config = {
  baseUrl: process.env.STRAPI_BASE_URL ?? 'http://localhost:1337/api',
  adminEmail: process.env.STRAPI_ADMIN_EMAIL ?? 'admin@pitango.local',
  adminPassword: process.env.STRAPI_ADMIN_PASSWORD ?? 'Admin@123',
  employeeEmail: process.env.STRAPI_EMPLOYEE_EMAIL ?? 'employee@pitango.local',
  employeePassword: process.env.STRAPI_EMPLOYEE_PASSWORD ?? 'Employee@123',
  evidenceFilePath: process.env.EVIDENCE_FILE_PATH ?? '/tmp/pitango-evidence.txt',
};

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

const summary = {
  trackId: null,
  taskId: null,
  assignmentId: null,
  executionId: null,
  evidenceIds: [],
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

const expectErrorCode = (result, expectedStatus, expectedCode, context) => {
  const code = result.body?.error?.details?.code;

  if (result.response.status !== expectedStatus || code !== expectedCode) {
    fail(
      `${context} deveria retornar ${expectedStatus}/${expectedCode}, mas retornou ${result.response.status}/${code}\n${JSON.stringify(result.body, null, 2)}`
    );
  }

  summary.negativeChecks.push(`${context}: ${expectedCode}`);
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

const createTrack = async (adminJwt) => {
  const result = await request('/tracks', {
    method: 'POST',
    headers: authHeaders(adminJwt),
    body: JSON.stringify({
      data: {
        name: `Trilha Evidencia E2E ${timestamp}`,
        description: 'Trilha criada pelo teste automatizado de evidencias.',
        track_type: 'institutional',
        version: 1,
        is_active: true,
      },
    }),
  });

  const body = expectSuccess(result, 'Criacao da trilha com evidencia');
  const id = body?.data?.id;

  if (!id) {
    fail('Criacao da trilha nao retornou id');
  }

  summary.trackId = id;
  return id;
};

const createEvidenceTask = async (adminJwt, trackId) => {
  const result = await request('/tasks', {
    method: 'POST',
    headers: authHeaders(adminJwt),
    body: JSON.stringify({
      data: {
        title: `Enviar evidencia E2E ${timestamp}`,
        description: 'Tarefa criada pelo teste automatizado e exige anexo.',
        order_index: 1,
        is_required: true,
        requires_evidence: true,
        requires_manual_approval: false,
        action_type: 'upload',
        is_active: true,
        track: trackId,
      },
    }),
  });

  const body = expectSuccess(result, 'Criacao da tarefa que exige evidencia');
  const id = body?.data?.id;

  if (!id) {
    fail('Criacao da tarefa nao retornou id');
  }

  summary.taskId = id;
  return id;
};

const assignTrack = async (adminJwt, trackId, employeeId) => {
  const result = await request('/track-assignments', {
    method: 'POST',
    headers: authHeaders(adminJwt),
    body: JSON.stringify({
      data: {
        track: trackId,
        user: employeeId,
      },
    }),
  });

  const body = expectSuccess(result, 'Criacao da atribuicao da trilha');
  const id = body?.data?.id;

  if (!id) {
    fail('Criacao da atribuicao nao retornou id');
  }

  summary.assignmentId = id;
  return id;
};

const getExecution = async (employeeJwt, assignmentId) => {
  const result = await request(`/my-track-assignments/${assignmentId}/tasks`, {
    headers: {
      Authorization: `Bearer ${employeeJwt}`,
    },
  });

  const body = expectSuccess(result, 'Listagem das execucoes da atribuicao');
  const execution = body?.data?.[0];

  if (!execution?.id || !execution?.task?.requires_evidence) {
    fail(`Execucao com tarefa que exige evidencia nao encontrada\n${JSON.stringify(body, null, 2)}`);
  }

  summary.executionId = execution.id;
  return execution.id;
};

const expectCompleteWithoutEvidenceToFail = async (employeeJwt, executionId) => {
  const result = await request(`/task-executions/${executionId}/complete`, {
    method: 'POST',
    headers: authHeaders(employeeJwt),
  });

  expectErrorCode(
    result,
    400,
    'TASK_EVIDENCE_REQUIRED',
    'Conclusao sem evidencia'
  );
};

const uploadEvidence = async (employeeJwt, executionId) => {
  const fileBuffer = await readFile(config.evidenceFilePath).catch(() => null);

  if (!fileBuffer) {
    fail(`Arquivo de evidencia nao encontrado em ${config.evidenceFilePath}`);
  }

  const form = new FormData();
  form.append('notes', `Evidencia enviada pelo validate-evidences em ${timestamp}`);
  form.append('files', new Blob([fileBuffer], { type: 'text/plain' }), 'pitango-evidence.txt');

  const result = await request(`/task-executions/${executionId}/evidences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${employeeJwt}`,
    },
    body: form,
  });

  const body = expectSuccess(result, 'Upload de evidencia');
  const evidenceIds = body?.data?.map((evidence) => evidence.id).filter(Boolean) ?? [];

  if (evidenceIds.length === 0) {
    fail(`Upload de evidencia nao retornou ids\n${JSON.stringify(body, null, 2)}`);
  }

  summary.evidenceIds = evidenceIds;
  return evidenceIds;
};

const completeWithEvidence = async (employeeJwt, executionId) => {
  const result = await request(`/task-executions/${executionId}/complete`, {
    method: 'POST',
    headers: authHeaders(employeeJwt),
  });

  const body = expectSuccess(result, 'Conclusao com evidencia');

  if (body?.data?.execution_status !== 'completed') {
    fail(`Execucao nao foi concluida\n${JSON.stringify(body, null, 2)}`);
  }

  if (!Array.isArray(body?.data?.evidences) || body.data.evidences.length === 0) {
    fail(`Execucao concluida nao retornou evidencias\n${JSON.stringify(body, null, 2)}`);
  }

  return body;
};

const listEvidences = async (employeeJwt) => {
  const result = await request('/task-evidences?populate=*', {
    headers: {
      Authorization: `Bearer ${employeeJwt}`,
    },
  });

  const body = expectSuccess(result, 'Listagem de evidencias');

  if (!Array.isArray(body?.data)) {
    fail(`Listagem de evidencias retornou formato inesperado\n${JSON.stringify(body, null, 2)}`);
  }
};

const run = async () => {
  print('Iniciando validacao do ciclo de evidencias...');

  const admin = await login(config.adminEmail, config.adminPassword, 'admin');
  const employee = await login(config.employeeEmail, config.employeePassword, 'employee');
  const trackId = await createTrack(admin.jwt);

  await createEvidenceTask(admin.jwt, trackId);

  const assignmentId = await assignTrack(admin.jwt, trackId, employee.user.id);
  const executionId = await getExecution(employee.jwt, assignmentId);

  await expectCompleteWithoutEvidenceToFail(employee.jwt, executionId);
  await uploadEvidence(employee.jwt, executionId);
  await completeWithEvidence(employee.jwt, executionId);
  await listEvidences(employee.jwt);

  print('Validacao do ciclo de evidencias concluida com sucesso.');
  print(JSON.stringify(summary, null, 2));
};

await run();
