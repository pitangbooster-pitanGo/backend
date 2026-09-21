import { describe, it, expect, beforeAll } from 'vitest';
import { api, loginAs, authHeader } from '../helpers/http';
import { createTrack, createTask, assignTrackToUser, getExecutionsForAssignment } from '../helpers/factories';

describe('Aprovação manual', () => {
  let adminToken: string;
  let adminId: number;
  let employeeToken: string;
  let employeeId: number;

  beforeAll(async () => {
    ({ token: adminToken, userId: adminId } = await loginAs('admin'));
    ({ token: employeeToken, userId: employeeId } = await loginAs('employee'));
  });

  async function setupSubmittedExecution() {
    const track = await createTrack();
    const task = await createTask(track.id, {
      title: 'Exige aprovação',
      order_index: 1,
      requires_manual_approval: true,
    });
    const assignment = await assignTrackToUser(track.id, employeeId, adminId);
    const executions = await getExecutionsForAssignment(assignment.id);
    const exec = executions.find((e) => e.task_source_document_id === task.documentId)!;

    const client = await api();
    const submitted = await client
      .post(`/api/task-executions/${exec.documentId}/complete`)
      .set(authHeader(employeeToken));

    return { client, execDocumentId: exec.documentId as string, assignmentId: assignment.id, submitted };
  }

  it('concluir tarefa com aprovação manual fica "submitted", não "completed"', async () => {
    const { submitted, client, assignmentId } = await setupSubmittedExecution();

    expect(submitted.status).toBe(200);

    const assignmentRes = await client
      .get('/api/track-assignments')
      .set(authHeader(adminToken))
      .query({ 'filters[id][$eq]': assignmentId });
    // Progresso não conta a tarefa como concluída enquanto está pendente de aprovação.
    expect(assignmentRes.body.data[0].progress_percentage).toBe(0);
  });

  it('rejeição exige motivo (review_feedback)', async () => {
    const { client, execDocumentId } = await setupSubmittedExecution();

    const res = await client
      .post(`/api/task-executions/${execDocumentId}/reject`)
      .set(authHeader(adminToken))
      .send({ data: {} });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('TASK_EXECUTION_REJECTION_FEEDBACK_REQUIRED');
  });

  it('fluxo completo: enviar → rejeitar → reenviar → aprovar', async () => {
    const { client, execDocumentId, assignmentId } = await setupSubmittedExecution();

    const rejected = await client
      .post(`/api/task-executions/${execDocumentId}/reject`)
      .set(authHeader(adminToken))
      .send({ data: { review_feedback: 'Envie um documento mais claro.' } });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.execution_status).toBe('rejected');
    expect(rejected.body.data.review_feedback).toBe('Envie um documento mais claro.');

    const resubmitted = await client
      .post(`/api/task-executions/${execDocumentId}/complete`)
      .set(authHeader(employeeToken));
    expect(resubmitted.status).toBe(200);

    const approved = await client
      .post(`/api/task-executions/${execDocumentId}/approve`)
      .set(authHeader(adminToken))
      .send({ data: { review_feedback: 'Tudo certo.' } });
    expect(approved.status).toBe(200);
    expect(approved.body.data.execution_status).toBe('completed');
    expect(approved.body.data.validation_status).toBe('approved');

    const assignmentRes = await client
      .get('/api/track-assignments')
      .set(authHeader(adminToken))
      .query({ 'filters[id][$eq]': assignmentId });
    expect(assignmentRes.body.data[0].progress_percentage).toBe(100);
  });

  it('aprovar libera as tarefas que dependiam da aprovada', async () => {
    const track = await createTrack();
    const task1 = await createTask(track.id, {
      title: 'Requer aprovação',
      order_index: 1,
      requires_manual_approval: true,
    });
    const task2 = await createTask(track.id, {
      title: 'Depende da aprovação',
      order_index: 2,
      depends_on: [task1.id],
    });
    const assignment = await assignTrackToUser(track.id, employeeId, adminId);
    const client = await api();
    let executions = await getExecutionsForAssignment(assignment.id);
    const exec1 = executions.find((e) => e.task_source_document_id === task1.documentId)!;

    await client
      .post(`/api/task-executions/${exec1.documentId}/complete`)
      .set(authHeader(employeeToken));

    executions = await getExecutionsForAssignment(assignment.id);
    const exec2Before = executions.find((e) => e.task_source_document_id === task2.documentId);
    expect(exec2Before?.execution_status).toBe('locked');

    await client
      .post(`/api/task-executions/${exec1.documentId}/approve`)
      .set(authHeader(adminToken))
      .send({ data: {} });

    executions = await getExecutionsForAssignment(assignment.id);
    const exec2After = executions.find((e) => e.task_source_document_id === task2.documentId);
    expect(exec2After?.execution_status).toBe('available');
  });
});
