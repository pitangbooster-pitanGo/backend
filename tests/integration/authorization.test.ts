import { describe, it, expect } from 'vitest';
import { api, loginAs, authHeader } from '../helpers/http';
import { createTrack } from '../helpers/factories';

describe('Autorização por role', () => {
  it('employee não pode criar trilha', async () => {
    const { token } = await loginAs('employee');
    const client = await api();
    const res = await client
      .post('/api/tracks')
      .set(authHeader(token))
      .send({ data: { name: 'Trilha via employee', track_type: 'institutional', is_active: true } });

    expect(res.status).toBe(403);
  });

  it('admin pode criar trilha', async () => {
    const { token } = await loginAs('admin');
    const client = await api();
    const res = await client
      .post('/api/tracks')
      .set(authHeader(token))
      .send({ data: { name: `Trilha admin ${Date.now()}`, track_type: 'institutional', is_active: true } });

    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(1);
  });

  it('employee não pode criar tarefa', async () => {
    const track = await createTrack();
    const { token } = await loginAs('employee');
    const client = await api();
    const res = await client
      .post('/api/tasks')
      .set(authHeader(token))
      .send({
        data: {
          title: 'Tarefa via employee',
          order_index: 1,
          action_type: 'reading',
          is_required: true,
          is_active: true,
          track: track.id,
        },
      });

    expect(res.status).toBe(403);
  });

  it('employee não pode listar usuários', async () => {
    const { token } = await loginAs('employee');
    const client = await api();
    const res = await client.get('/api/users').set(authHeader(token));

    expect(res.status).toBe(403);
  });

  it('leadership pode listar usuários (perfil de gestão)', async () => {
    const { token } = await loginAs('leadership');
    const client = await api();
    const res = await client.get('/api/users').set(authHeader(token));

    expect(res.status).toBe(200);
  });

  it('employee não pode aprovar execução de tarefa', async () => {
    const { token } = await loginAs('employee');
    const client = await api();
    const res = await client
      .post('/api/task-executions/999999/approve')
      .set(authHeader(token))
      .send({ data: { review_feedback: 'ok' } });

    // 403 (bloqueado pela policy antes mesmo de checar se a execução existe)
    expect(res.status).toBe(403);
  });

  it('hr pode aprovar/rejeitar (rota liberada para o perfil, mesmo que o alvo não exista)', async () => {
    const { token } = await loginAs('hr');
    const client = await api();
    const res = await client
      .post('/api/task-executions/999999/reject')
      .set(authHeader(token))
      .send({ data: { review_feedback: 'motivo' } });

    // policy libera o perfil; a regra de negócio (execução não encontrada) responde depois
    expect(res.status).not.toBe(403);
  });
});
