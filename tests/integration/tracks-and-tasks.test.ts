import { describe, it, expect, beforeAll } from 'vitest';
import { api, loginAs, authHeader } from '../helpers/http';
import { createTrack, uniqueSuffix } from '../helpers/factories';

describe('Trilhas e tarefas', () => {
  let adminToken: string;

  beforeAll(async () => {
    ({ token: adminToken } = await loginAs('admin'));
  });

  it('criar trilha começa na versão 1 e gera um snapshot imutável', async () => {
    const client = await api();
    const name = `Trilha versionada ${uniqueSuffix()}`;
    const created = await client
      .post('/api/tracks')
      .set(authHeader(adminToken))
      .send({ data: { name, track_type: 'institutional', is_active: true } });

    expect(created.status).toBe(201);
    expect(created.body.data.version).toBe(1);

    const details = await client
      .get(`/api/tracks/${created.body.data.documentId}/details`)
      .set(authHeader(adminToken));

    expect(details.status).toBe(200);
    expect(details.body.data.name).toBe(name);
    expect(details.body.meta.version).toBe(1);
  });

  it('criar tarefa incrementa a versão da trilha', async () => {
    const track = await createTrack();
    const client = await api();

    const before = await client
      .get(`/api/tracks/${track.documentId}/details`)
      .set(authHeader(adminToken));
    expect(before.body.meta.version).toBe(1);

    await client
      .post('/api/tasks')
      .set(authHeader(adminToken))
      .send({
        data: {
          title: 'Primeira tarefa',
          order_index: 1,
          action_type: 'reading',
          is_required: true,
          is_active: true,
          track: track.id,
        },
      });

    const after = await client
      .get(`/api/tracks/${track.documentId}/details`)
      .set(authHeader(adminToken));
    expect(after.body.meta.version).toBe(2);
  });

  it('dependência com ordem igual/posterior é rejeitada', async () => {
    const track = await createTrack();
    const client = await api();

    const taskA = await client
      .post('/api/tasks')
      .set(authHeader(adminToken))
      .send({
        data: {
          title: 'Tarefa A',
          order_index: 2,
          action_type: 'reading',
          is_required: true,
          is_active: true,
          track: track.id,
        },
      });

    const res = await client
      .post('/api/tasks')
      .set(authHeader(adminToken))
      .send({
        data: {
          title: 'Tarefa B (ordem <= dependência)',
          order_index: 1,
          action_type: 'reading',
          is_required: true,
          is_active: true,
          track: track.id,
          depends_on: [taskA.body.data.id],
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('TASK_DEPENDENCY_ORDER_INVALID');
  });

  it('dependência de trilha diferente é rejeitada', async () => {
    const trackX = await createTrack();
    const trackY = await createTrack();
    const client = await api();

    const taskInX = await client
      .post('/api/tasks')
      .set(authHeader(adminToken))
      .send({
        data: {
          title: 'Tarefa na trilha X',
          order_index: 1,
          action_type: 'reading',
          is_required: true,
          is_active: true,
          track: trackX.id,
        },
      });

    const res = await client
      .post('/api/tasks')
      .set(authHeader(adminToken))
      .send({
        data: {
          title: 'Tarefa na trilha Y dependendo de X',
          order_index: 2,
          action_type: 'reading',
          is_required: true,
          is_active: true,
          track: trackY.id,
          depends_on: [taskInX.body.data.id],
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('TASK_DEPENDENCY_TRACK_MISMATCH');
  });

  it('tarefa não pode depender dela mesma', async () => {
    const track = await createTrack();
    const client = await api();

    const task = await client
      .post('/api/tasks')
      .set(authHeader(adminToken))
      .send({
        data: {
          title: 'Tarefa auto-dependente',
          order_index: 1,
          action_type: 'reading',
          is_required: true,
          is_active: true,
          track: track.id,
        },
      });

    const res = await client
      .put(`/api/tasks/${task.body.data.documentId}`)
      .set(authHeader(adminToken))
      .send({
        data: {
          order_index: 2,
          depends_on: [task.body.data.id],
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('TASK_DEPENDS_ON_ITSELF');
  });
});
