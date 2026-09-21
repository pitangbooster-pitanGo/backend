import { describe, it, expect } from 'vitest';
import { api, loginAs, authHeader } from '../helpers/http';
import {
  assignTrackToUser,
  createTestUser,
  getExecutionsForAssignment,
  uniqueSuffix,
} from '../helpers/factories';
import { getTestStrapi } from '../setup/strapi-instance';

/**
 * Validação humana do resultado da IA: só as ações `approve`/`reject` tiram uma
 * sugestão de `pending_review`, e só `approve` cria a trilha real.
 */

type Structure = {
  track: { name: string; description: string; track_type: string };
  tasks: Array<{ title: string; description: string; order_index: number; action_type: string; requires_evidence: boolean; requires_manual_approval: boolean; depends_on: number[] }>;
};

const generate = async (token: string) => {
  const client = await api();
  const goal = `Revisão humana ${uniqueSuffix()}`;
  const res = await client.post('/api/ai-suggestions').set(authHeader(token)).send({ data: { goal } });
  expect(res.status).toBe(201);
  return { suggestion: res.body.data, goal, structure: res.body.data.original_result as Structure };
};

const review = async (token: string, id: string, action: 'approve' | 'reject', data: Record<string, unknown> = {}) => {
  const client = await api();
  return client.post(`/api/ai-suggestions/${id}/${action}`).set(authHeader(token)).send({ data });
};

const trackByName = async (name: string) =>
  (await getTestStrapi()).db.query('api::track.track').findMany({ where: { name } });

const stored = async (id: number) =>
  (await getTestStrapi()).db.query('api::ai-suggestion.ai-suggestion').findOne({
    where: { id },
    populate: ['created_by_user', 'reviewed_by_user', 'track'],
  });

describe('POST /api/ai-suggestions/:id/approve', () => {
  it('aprova sem edição: status approved, resultado final = original, revisor/data registrados', async () => {
    const { token: generatorToken } = await loginAs('leadership');
    const { token: reviewerToken, userId: reviewerId } = await loginAs('hr');
    const { suggestion, structure } = await generate(generatorToken);

    const res = await review(reviewerToken, suggestion.documentId, 'approve', { review_notes: 'Ok para publicar' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'approved', review_notes: 'Ok para publicar' });
    expect(res.body.data.final_result).toEqual(structure);
    expect(res.body.data.original_result).toEqual(structure);
    expect(res.body.data.reviewed_at).toEqual(expect.any(String));
    expect(res.body.data.track).toMatchObject({ name: structure.track.name });

    const row = await stored(suggestion.id);
    expect(row.reviewed_by_user.id).toBe(reviewerId);
    expect(row.created_by_user.id).not.toBe(reviewerId);
    expect(row.track.id).toBe(res.body.data.track.id);
  });

  it('a trilha criada é real: versão 1, tarefas, dependências e snapshot completos', async () => {
    const { token } = await loginAs('admin');
    const { suggestion, structure } = await generate(token);

    const res = await review(token, suggestion.documentId, 'approve');
    expect(res.status).toBe(200);

    const client = await api();
    const details = await client
      .get(`/api/tracks/${res.body.data.track.documentId}/details`)
      .set(authHeader(token));
    expect(details.status).toBe(200);
    expect(details.body.meta.version).toBe(1);
    expect(details.body.data.tasks).toHaveLength(structure.tasks.length);

    const strapi = await getTestStrapi();
    const tasks = await strapi.db.query('api::task.task').findMany({
      where: { track: { id: res.body.data.track.id } },
      populate: ['depends_on'],
      orderBy: { order_index: 'asc' },
    });
    expect(tasks.map((t: any) => t.title)).toEqual(structure.tasks.map((t) => t.title));
    expect(tasks[0].depends_on).toHaveLength(0);
    // "depende da posição N" virou dependência da tarefa real de posição N.
    expect(tasks[1].depends_on.map((d: any) => d.id)).toEqual([tasks[0].id]);
    expect(tasks[3]).toMatchObject({ action_type: 'upload', requires_evidence: true, requires_manual_approval: true });

    // Auditoria: quem criou a trilha e as tarefas foi o revisor.
    const logs = await strapi.db.query('api::audit-log.audit-log').findMany({
      where: { entity_id: res.body.data.track.documentId },
    });
    expect(logs).toHaveLength(1);
  });

  it('a trilha aprovada é atribuível e o bloqueio por dependência funciona', async () => {
    const { token, userId } = await loginAs('admin');
    const { suggestion } = await generate(token);
    const approved = await review(token, suggestion.documentId, 'approve');

    const employee = await createTestUser({ role: 'employee' });
    const assignment = await assignTrackToUser(approved.body.data.track.id, employee.id, userId);
    const executions = await getExecutionsForAssignment(assignment.id);

    expect(executions).toHaveLength(5);
    expect(executions.map((e: any) => e.execution_status)).toEqual([
      'available',
      'locked',
      'locked',
      'locked',
      'locked',
    ]);
  });

  it('aprova COM edição: status edited, guarda original e final, cria a trilha editada', async () => {
    const { token } = await loginAs('leadership');
    const { suggestion, structure } = await generate(token);

    const edited: Structure = JSON.parse(JSON.stringify(structure));
    edited.track.name = `${structure.track.name} (revisada)`;
    edited.tasks[0].title = 'Título ajustado pelo revisor';
    edited.tasks = edited.tasks.slice(0, 3); // o revisor removeu as duas últimas tarefas

    const res = await review(token, suggestion.documentId, 'approve', { final_result: edited });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('edited');
    expect(res.body.data.original_result).toEqual(structure); // o que a IA propôs, intacto
    expect(res.body.data.final_result.track.name).toBe(edited.track.name);
    expect(res.body.data.final_result.tasks).toHaveLength(3);

    const strapi = await getTestStrapi();
    const tasks = await strapi.db.query('api::task.task').findMany({
      where: { track: { id: res.body.data.track.id } },
      orderBy: { order_index: 'asc' },
    });
    expect(tasks.map((t: any) => t.title)[0]).toBe('Título ajustado pelo revisor');
    expect(tasks).toHaveLength(3);
  });

  it('enviar final_result idêntico ao original conta como approved, não edited', async () => {
    const { token } = await loginAs('admin');
    const { suggestion, structure } = await generate(token);
    const res = await review(token, suggestion.documentId, 'approve', { final_result: structure });
    expect(res.body.data.status).toBe('approved');
  });

  it('edição inválida (dependência posterior): 400 e nada é criado nem alterado', async () => {
    const { token } = await loginAs('admin');
    const { suggestion, structure } = await generate(token);
    const before = await (await getTestStrapi()).db.query('api::track.track').count({});

    const broken: Structure = JSON.parse(JSON.stringify(structure));
    broken.tasks[0].depends_on = [3];
    const res = await review(token, suggestion.documentId, 'approve', { final_result: broken });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('AI_SUGGESTION_EDIT_INVALID');
    expect(res.body.error.details.issues[0].path).toBe('tasks[0].depends_on');
    expect(await (await getTestStrapi()).db.query('api::track.track').count({})).toBe(before);
    expect((await stored(suggestion.id)).status).toBe('pending_review');
  });

  it('final_result que não é uma estrutura (null, texto) também é 400', async () => {
    const { token } = await loginAs('admin');
    const { suggestion } = await generate(token);
    for (const bad of [null, 'texto', 42]) {
      const res = await review(token, suggestion.documentId, 'approve', { final_result: bad });
      expect(res.status).toBe(400);
    }
    expect((await stored(suggestion.id)).status).toBe('pending_review');
  });

  it('não é possível aprovar duas vezes: 400 AI_SUGGESTION_NOT_PENDING, uma única trilha', async () => {
    const { token } = await loginAs('admin');
    const { suggestion, structure } = await generate(token);

    expect((await review(token, suggestion.documentId, 'approve')).status).toBe(200);
    const again = await review(token, suggestion.documentId, 'approve');

    expect(again.status).toBe(400);
    expect(again.body.error.details.code).toBe('AI_SUGGESTION_NOT_PENDING');
    expect(await trackByName(structure.track.name)).toHaveLength(1);
  });

  it('aprovações concorrentes: exatamente uma vence e só uma trilha é criada', async () => {
    const { token } = await loginAs('admin');
    const { suggestion, structure } = await generate(token);

    const results = await Promise.all([
      review(token, suggestion.documentId, 'approve'),
      review(token, suggestion.documentId, 'approve'),
      review(token, suggestion.documentId, 'approve'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    expect(await trackByName(structure.track.name)).toHaveLength(1);
  });

  it('falha na criação real desfaz TUDO: sugestão continua pending_review e sem trilha órfã', async () => {
    const { token, userId } = await loginAs('admin');
    const strapi = await getTestStrapi();
    const name = `Trilha corrompida ${uniqueSuffix()}`;
    // Resultado armazenado com um título maior que o varchar(255) da coluna: o
    // INSERT da tarefa falha DEPOIS de a trilha já ter sido criada na transação.
    const row = await strapi.db.query('api::ai-suggestion.ai-suggestion').create({
      data: {
        goal: 'Sugestão com dado corrompido',
        track_type: 'project',
        status: 'pending_review',
        created_by_user: userId,
        original_result: {
          track: { name, description: '', track_type: 'project' },
          tasks: [
            { title: 'Ok', description: '', order_index: 1, action_type: 'reading', requires_evidence: false, requires_manual_approval: false, depends_on: [] },
            { title: 'x'.repeat(300), description: '', order_index: 2, action_type: 'reading', requires_evidence: false, requires_manual_approval: false, depends_on: [1] },
          ],
        },
      },
    });
    const tasksBefore = await strapi.db.query('api::task.task').count({});

    const res = await review(token, row.documentId, 'approve');

    expect(res.status).toBe(500);
    expect(res.body.error.details.code).toBe('AI_SUGGESTION_APPROVE_FAILED');
    expect(await trackByName(name)).toHaveLength(0);
    expect(await strapi.db.query('api::task.task').count({})).toBe(tasksBefore);
    const after = await stored(row.id);
    expect(after.status).toBe('pending_review');
    expect(after.reviewed_by_user).toBeNull();
  });

  it('observações longas demais: 400', async () => {
    const { token } = await loginAs('admin');
    const { suggestion } = await generate(token);
    const res = await review(token, suggestion.documentId, 'approve', { review_notes: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
    expect((await stored(suggestion.id)).status).toBe('pending_review');
  });
});

describe('POST /api/ai-suggestions/:id/reject', () => {
  it('rejeita com motivo: status rejected, motivo/revisor/data gravados, nenhuma trilha criada', async () => {
    const { token: generatorToken } = await loginAs('leadership');
    const { token, userId } = await loginAs('admin');
    const { suggestion, structure } = await generate(generatorToken);

    const res = await review(token, suggestion.documentId, 'reject', { review_notes: 'Fora do escopo' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'rejected', review_notes: 'Fora do escopo', track: null });
    expect(res.body.data.reviewed_at).toEqual(expect.any(String));
    expect(res.body.data.final_result).toBeNull();
    expect(res.body.data.original_result).toEqual(structure);
    expect(await trackByName(structure.track.name)).toHaveLength(0);
    expect((await stored(suggestion.id)).reviewed_by_user.id).toBe(userId);
  });

  it.each([[undefined], ['   '], ['x'.repeat(1001)]])('motivo ausente/inválido (%#) → 400 e continua pendente', async (notes) => {
    const { token } = await loginAs('admin');
    const { suggestion } = await generate(token);
    const res = await review(token, suggestion.documentId, 'reject', { review_notes: notes });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('AI_SUGGESTION_REJECTION_NOTES_REQUIRED');
    expect((await stored(suggestion.id)).status).toBe('pending_review');
  });

  it('uma sugestão rejeitada não pode mais ser aprovada nem rejeitada de novo', async () => {
    const { token } = await loginAs('admin');
    const { suggestion, structure } = await generate(token);
    await review(token, suggestion.documentId, 'reject', { review_notes: 'Não' });

    const approve = await review(token, suggestion.documentId, 'approve');
    const reject = await review(token, suggestion.documentId, 'reject', { review_notes: 'De novo' });

    expect(approve.status).toBe(400);
    expect(approve.body.error.details.code).toBe('AI_SUGGESTION_NOT_PENDING');
    expect(reject.status).toBe(400);
    expect(await trackByName(structure.track.name)).toHaveLength(0);
  });

  it('uma sugestão aprovada não pode ser rejeitada depois', async () => {
    const { token } = await loginAs('admin');
    const { suggestion } = await generate(token);
    await review(token, suggestion.documentId, 'approve');
    const res = await review(token, suggestion.documentId, 'reject', { review_notes: 'Tarde demais' });
    expect(res.status).toBe(400);
    expect((await stored(suggestion.id)).status).toBe('approved');
  });
});

describe('Acesso às ações de revisão', () => {
  it('colaborador não pode aprovar nem rejeitar (403) e nada muda', async () => {
    const { token: adminToken } = await loginAs('admin');
    const { token } = await loginAs('employee');
    const { suggestion } = await generate(adminToken);

    expect((await review(token, suggestion.documentId, 'approve')).status).toBe(403);
    expect((await review(token, suggestion.documentId, 'reject', { review_notes: 'x' })).status).toBe(403);
    expect((await stored(suggestion.id)).status).toBe('pending_review');
  });

  it('sem autenticação não revisa', async () => {
    const client = await api();
    const res = await client.post('/api/ai-suggestions/qualquer/approve').send({ data: {} });
    expect([401, 403]).toContain(res.status);
  });

  it('sugestão inexistente: 404', async () => {
    const { token } = await loginAs('admin');
    expect((await review(token, 'nao-existe-123', 'approve')).status).toBe(404);
    expect((await review(token, 'nao-existe-123', 'reject', { review_notes: 'x' })).status).toBe(404);
  });
});
