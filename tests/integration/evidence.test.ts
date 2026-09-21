import { describe, it, expect, beforeAll } from 'vitest';
import { api, loginAs, authHeader } from '../helpers/http';
import { createTrack, createTask, assignTrackToUser, getExecutionsForAssignment } from '../helpers/factories';

describe('Evidência obrigatória', () => {
  let adminId: number;
  let employeeToken: string;
  let employeeId: number;

  beforeAll(async () => {
    ({ userId: adminId } = await loginAs('admin'));
    ({ token: employeeToken, userId: employeeId } = await loginAs('employee'));
  });

  it('concluir tarefa que exige evidência sem anexar nada é rejeitado', async () => {
    const track = await createTrack();
    const task = await createTask(track.id, {
      title: 'Exige evidência',
      order_index: 1,
      requires_evidence: true,
    });
    const assignment = await assignTrackToUser(track.id, employeeId, adminId);
    const executions = await getExecutionsForAssignment(assignment.id);
    const exec = executions.find((e) => e.task_source_document_id === task.documentId)!;

    const client = await api();
    const res = await client
      .post(`/api/task-executions/${exec.documentId}/complete`)
      .set(authHeader(employeeToken));

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('TASK_EVIDENCE_REQUIRED');
  });

  it('anexar evidência por link permite concluir a tarefa', async () => {
    const track = await createTrack();
    const task = await createTask(track.id, {
      title: 'Exige evidência (link)',
      order_index: 1,
      requires_evidence: true,
    });
    const assignment = await assignTrackToUser(track.id, employeeId, adminId);
    const executions = await getExecutionsForAssignment(assignment.id);
    const exec = executions.find((e) => e.task_source_document_id === task.documentId)!;

    const client = await api();
    const attach = await client
      .post(`/api/my-task-executions/${exec.documentId}/evidences`)
      .set(authHeader(employeeToken))
      .send({ data: { evidence_type: 'link', external_url: 'https://example.com/evidencia' } });

    expect(attach.status).toBe(201);

    const complete = await client
      .post(`/api/task-executions/${exec.documentId}/complete`)
      .set(authHeader(employeeToken));

    expect(complete.status).toBe(200);
  });

  it('evidência por link exige uma URL http(s) válida', async () => {
    const track = await createTrack();
    const task = await createTask(track.id, {
      title: 'Exige evidência (link inválido)',
      order_index: 1,
      requires_evidence: true,
    });
    const assignment = await assignTrackToUser(track.id, employeeId, adminId);
    const executions = await getExecutionsForAssignment(assignment.id);
    const exec = executions.find((e) => e.task_source_document_id === task.documentId)!;

    const client = await api();
    const res = await client
      .post(`/api/my-task-executions/${exec.documentId}/evidences`)
      .set(authHeader(employeeToken))
      .send({ data: { evidence_type: 'link', external_url: 'nao-e-uma-url' } });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('TASK_EVIDENCE_URL_REQUIRED');
  });

  it('remover a evidência deixa a tarefa novamente sem evidência (não pode concluir)', async () => {
    const track = await createTrack();
    const task = await createTask(track.id, {
      title: 'Evidência removível',
      order_index: 1,
      requires_evidence: true,
    });
    const assignment = await assignTrackToUser(track.id, employeeId, adminId);
    const executions = await getExecutionsForAssignment(assignment.id);
    const exec = executions.find((e) => e.task_source_document_id === task.documentId)!;

    const client = await api();
    const attach = await client
      .post(`/api/my-task-executions/${exec.documentId}/evidences`)
      .set(authHeader(employeeToken))
      .send({ data: { evidence_type: 'link', external_url: 'https://example.com/e' } });

    const evidenceDocumentId = attach.body.data[0].documentId;

    const removed = await client
      .delete(`/api/my-task-executions/${exec.documentId}/evidences/${evidenceDocumentId}`)
      .set(authHeader(employeeToken));
    expect(removed.status).toBe(204);

    const complete = await client
      .post(`/api/task-executions/${exec.documentId}/complete`)
      .set(authHeader(employeeToken));
    expect(complete.status).toBe(400);
    expect(complete.body.error.details.code).toBe('TASK_EVIDENCE_REQUIRED');
  });
});
