import { describe, it, expect, beforeAll } from 'vitest';
import { api, loginAs, authHeader } from '../helpers/http';
import { createTrack, createTask, assignTrackToUser, getExecutionsForAssignment } from '../helpers/factories';

describe('Atribuições, dependências e progresso', () => {
  let adminToken: string;
  let adminId: number;
  let employeeToken: string;
  let employeeId: number;

  beforeAll(async () => {
    ({ token: adminToken, userId: adminId } = await loginAs('admin'));
    ({ token: employeeToken, userId: employeeId } = await loginAs('employee'));
  });

  it('tarefa sem dependência começa "available"; tarefa dependente começa "locked"', async () => {
    const track = await createTrack();
    const task1 = await createTask(track.id, { title: 'Tarefa 1', order_index: 1 });
    const task2 = await createTask(track.id, {
      title: 'Tarefa 2',
      order_index: 2,
      depends_on: [task1.id],
    });

    const assignment = await assignTrackToUser(track.id, employeeId, adminId);
    const executions = await getExecutionsForAssignment(assignment.id);

    const exec1 = executions.find((e) => e.task_source_document_id === task1.documentId);
    const exec2 = executions.find((e) => e.task_source_document_id === task2.documentId);

    expect(exec1?.execution_status).toBe('available');
    expect(exec2?.execution_status).toBe('locked');
  });

  it('concluir a dependência libera a tarefa seguinte e atualiza o progresso', async () => {
    const track = await createTrack();
    const task1 = await createTask(track.id, { title: 'Passo 1', order_index: 1 });
    const task2 = await createTask(track.id, {
      title: 'Passo 2',
      order_index: 2,
      depends_on: [task1.id],
    });

    const assignment = await assignTrackToUser(track.id, employeeId, adminId);
    const client = await api();
    let executions = await getExecutionsForAssignment(assignment.id);
    const exec1 = executions.find((e) => e.task_source_document_id === task1.documentId)!;

    const complete1 = await client
      .post(`/api/task-executions/${exec1.documentId}/complete`)
      .set(authHeader(employeeToken));
    expect(complete1.status).toBe(200);

    executions = await getExecutionsForAssignment(assignment.id);
    const exec2After = executions.find((e) => e.task_source_document_id === task2.documentId);
    expect(exec2After?.execution_status).toBe('available');

    const assignmentRes = await client
      .get('/api/track-assignments')
      .set(authHeader(adminToken))
      .query({ 'filters[id][$eq]': assignment.id });
    expect(assignmentRes.body.data[0].progress_percentage).toBe(50);
    expect(assignmentRes.body.data[0].status).toBe('in_progress');
  });

  it('concluir todas as tarefas fecha a trilha como "completed" com progresso 100%', async () => {
    const track = await createTrack();
    const task1 = await createTask(track.id, { title: 'Único passo', order_index: 1 });

    const assignment = await assignTrackToUser(track.id, employeeId, adminId);
    const client = await api();
    const executions = await getExecutionsForAssignment(assignment.id);
    const exec1 = executions.find((e) => e.task_source_document_id === task1.documentId)!;

    await client
      .post(`/api/task-executions/${exec1.documentId}/complete`)
      .set(authHeader(employeeToken));

    const assignmentRes = await client
      .get('/api/track-assignments')
      .set(authHeader(adminToken))
      .query({ 'filters[id][$eq]': assignment.id });

    expect(assignmentRes.body.data[0].progress_percentage).toBe(100);
    expect(assignmentRes.body.data[0].status).toBe('completed');
    expect(assignmentRes.body.data[0].completed_at).not.toBeNull();
  });

  it('colaborador não pode concluir tarefa bloqueada por dependência pendente', async () => {
    const track = await createTrack();
    const task1 = await createTask(track.id, { title: 'Bloqueadora', order_index: 1 });
    const task2 = await createTask(track.id, {
      title: 'Bloqueada',
      order_index: 2,
      depends_on: [task1.id],
    });

    const assignment = await assignTrackToUser(track.id, employeeId, adminId);
    const client = await api();
    const executions = await getExecutionsForAssignment(assignment.id);
    const exec2 = executions.find((e) => e.task_source_document_id === task2.documentId)!;

    const res = await client
      .post(`/api/task-executions/${exec2.documentId}/complete`)
      .set(authHeader(employeeToken));

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('TASK_EXECUTION_NOT_AVAILABLE');
  });
});
