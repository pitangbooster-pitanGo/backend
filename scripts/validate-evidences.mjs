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
        requires_manual_approval: true,
        action_type: 'upload',
        is_active: true,
        track: trackId,
        materials: [
          {
            title: 'Material E2E',
            material_type: 'link',
            order_index: 0,
            external_url: 'https://example.com/material-e2e',
          },
        ],
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

  if (
    !execution?.id ||
    !execution?.documentId ||
    !execution?.task_snapshot?.requiresEvidence ||
    execution.task_snapshot.materials?.[0]?.externalUrl !==
      'https://example.com/material-e2e'
  ) {
    fail(`Execucao com tarefa que exige evidencia nao encontrada\n${JSON.stringify(body, null, 2)}`);
  }

  summary.executionId = execution.id;
  return execution;
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

const uploadEvidence = async (employeeJwt, executionDocumentId) => {
  const fileBuffer = await readFile(config.evidenceFilePath).catch(() => null);

  if (!fileBuffer) {
    fail(`Arquivo de evidencia nao encontrado em ${config.evidenceFilePath}`);
  }

  const form = new FormData();
  form.append('notes', `Evidencia enviada pelo validate-evidences em ${timestamp}`);
  form.append('files', new Blob([fileBuffer], { type: 'application/pdf' }), 'pitango-evidence.pdf');

  const result = await request(`/my-task-executions/${executionDocumentId}/evidences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${employeeJwt}`,
    },
    body: form,
  });

  const body = expectSuccess(result, 'Upload de evidencia');
  const evidences = body?.data ?? [];
  const evidenceIds = evidences.map((evidence) => evidence.id).filter(Boolean);

  if (evidenceIds.length === 0) {
    fail(`Upload de evidencia nao retornou ids\n${JSON.stringify(body, null, 2)}`);
  }

  summary.evidenceIds = evidenceIds;
  return evidences;
};

const removeEvidence = async (employeeJwt, executionDocumentId, evidenceDocumentId) => {
  const result = await request(
    `/my-task-executions/${executionDocumentId}/evidences/${evidenceDocumentId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${employeeJwt}`,
      },
    }
  );

  if (result.response.status !== 204) {
    fail(
      `Remocao de evidencia deveria retornar 204, retornou ${result.response.status}\n` +
        JSON.stringify(result.body, null, 2)
    );
  }
};

const attachLinkEvidence = async (employeeJwt, executionDocumentId) => {
  const result = await request(
    `/my-task-executions/${executionDocumentId}/evidences`,
    {
      method: 'POST',
      headers: authHeaders(employeeJwt),
      body: JSON.stringify({
        data: {
          evidence_type: 'link',
          external_url: 'https://example.com/evidencia-e2e',
          notes: `Link enviado pelo validate-evidences em ${timestamp}`,
        },
      }),
    }
  );

  const body = expectSuccess(result, 'Envio de evidencia por link');
  const evidence = body?.data?.[0];

  if (
    !evidence?.id ||
    evidence.evidence_type !== 'link' ||
    evidence.external_url !== 'https://example.com/evidencia-e2e'
  ) {
    fail(`Evidencia por link invalida\n${JSON.stringify(body, null, 2)}`);
  }

  summary.evidenceIds.push(evidence.id);
  return evidence;
};

const completeWithEvidence = async (employeeJwt, executionId) => {
  const result = await request(`/task-executions/${executionId}/complete`, {
    method: 'POST',
    headers: authHeaders(employeeJwt),
  });

  const body = expectSuccess(result, 'Conclusao com evidencia');

  if (body?.data?.execution_status !== 'submitted') {
    fail(`Execucao nao foi submetida\n${JSON.stringify(body, null, 2)}`);
  }

  if (!Array.isArray(body?.data?.evidences) || body.data.evidences.length === 0) {
    fail(`Execucao concluida nao retornou evidencias\n${JSON.stringify(body, null, 2)}`);
  }

  return body;
};

const reviewExecution = async (adminJwt, executionId, decision, feedback) => {
  const result = await request(`/task-executions/${executionId}/${decision}`, {
    method: 'POST',
    headers: authHeaders(adminJwt),
    body: JSON.stringify({
      data: {
        review_feedback: feedback,
      },
    }),
  });

  return expectSuccess(result, `${decision} da execucao`);
};

const expectGlobalEvidenceListToBeForbidden = async (employeeJwt) => {
  const result = await request('/task-evidences?populate=*', {
    headers: {
      Authorization: `Bearer ${employeeJwt}`,
    },
  });

  if (result.response.status !== 403) {
    fail(
      `Listagem global de evidencias deveria retornar 403, retornou ${result.response.status}\n` +
        JSON.stringify(result.body, null, 2)
    );
  }

  summary.negativeChecks.push('Listagem global de evidencias bloqueada para employee');
};

const run = async () => {
  print('Iniciando validacao do ciclo de evidencias...');

  const admin = await login(config.adminEmail, config.adminPassword, 'admin');
  const employee = await login(config.employeeEmail, config.employeePassword, 'employee');
  const trackId = await createTrack(admin.jwt);

  await createEvidenceTask(admin.jwt, trackId);

  const assignmentId = await assignTrack(admin.jwt, trackId, employee.user.id);
  const execution = await getExecution(employee.jwt, assignmentId);

  await expectCompleteWithoutEvidenceToFail(employee.jwt, execution.id);
  const firstUpload = await uploadEvidence(employee.jwt, execution.documentId);
  await removeEvidence(employee.jwt, execution.documentId, firstUpload[0].documentId);
  await attachLinkEvidence(employee.jwt, execution.documentId);
  await completeWithEvidence(employee.jwt, execution.id);
  const rejected = await reviewExecution(
    admin.jwt,
    execution.id,
    'reject',
    'Reenvie a evidencia para o teste E2E.'
  );

  if (
    rejected?.data?.execution_status !== 'rejected' ||
    rejected?.data?.review_feedback !== 'Reenvie a evidencia para o teste E2E.'
  ) {
    fail(`Execucao nao foi rejeitada corretamente\n${JSON.stringify(rejected, null, 2)}`);
  }

  const resubmitted = await completeWithEvidence(employee.jwt, execution.id);

  if (resubmitted?.data?.review_feedback !== null) {
    fail(`Reenvio nao limpou o feedback anterior\n${JSON.stringify(resubmitted, null, 2)}`);
  }

  const approved = await reviewExecution(
    admin.jwt,
    execution.id,
    'approve',
    'Evidencia aprovada no teste E2E.'
  );

  if (approved?.data?.execution_status !== 'completed') {
    fail(`Execucao nao foi aprovada\n${JSON.stringify(approved, null, 2)}`);
  }

  await expectGlobalEvidenceListToBeForbidden(employee.jwt);

  print('Validacao do ciclo de evidencias concluida com sucesso.');
  print(JSON.stringify(summary, null, 2));
};

await run();
