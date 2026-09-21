import { describe, it, expect } from 'vitest';
import { api, loginAs, authHeader } from '../helpers/http';
import { createTrack, uniqueSuffix } from '../helpers/factories';
import { getTestStrapi } from '../setup/strapi-instance';

/**
 * Fluxo de IA de ponta a ponta pela API real: Frontend → Backend → AIService
 * (provedor mock) → MCP (ferramenta local no banco real) → AIResultValidator →
 * rascunho `pending_review`. Nenhum teste aqui chama IA real (o harness força
 * AI_PROVIDER=mock) e AI_TIMEOUT_MS=1500 para o cenário de timeout.
 */

const generate = async (token: string, goal: string, extra: Record<string, unknown> = {}) => {
  const client = await api();
  return client
    .post('/api/ai-suggestions')
    .set(authHeader(token))
    .send({ data: { goal, ...extra } });
};

const count = async (uid: 'api::track.track' | 'api::ai-suggestion.ai-suggestion') => {
  const strapi = await getTestStrapi();
  return strapi.db.query(uid).count({});
};

describe('POST /api/ai-suggestions — geração do rascunho', () => {
  it('gestão gera uma sugestão pending_review, sem criar trilha nem tarefa', async () => {
    const { token, userId } = await loginAs('leadership');
    const tracksBefore = await count('api::track.track');
    const tasksBefore = await (await getTestStrapi()).db.query('api::task.task').count({});
    const goal = `Onboarding de dados ${uniqueSuffix()}`;

    const res = await generate(token, goal, { track_type: 'institutional' });

    expect(res.status).toBe(201);
    const suggestion = res.body.data;
    expect(suggestion).toMatchObject({
      goal,
      status: 'pending_review',
      provider: 'mock',
      final_result: null,
      reviewed_at: null,
      track_type: 'institutional',
    });
    expect(suggestion.original_result.track.name).toBe(`Trilha: ${goal}`);
    expect(suggestion.original_result.tasks).toHaveLength(5);
    expect(suggestion.warnings).toEqual([]);

    // Pendente ≠ aprovado: nada real foi criado e ninguém revisou.
    expect(await count('api::track.track')).toBe(tracksBefore);
    expect((await getTestStrapi()).db.query('api::task.task').count({})).resolves.toBe(tasksBefore);

    const strapi = await getTestStrapi();
    const stored = await strapi.db.query('api::ai-suggestion.ai-suggestion').findOne({
      where: { id: suggestion.id },
      populate: ['created_by_user', 'reviewed_by_user', 'track'],
    });
    expect(stored.created_by_user.id).toBe(userId);
    expect(stored.reviewed_by_user).toBeNull();
    expect(stored.track).toBeNull();
  });

  it('usa "project" como tipo padrão e ignora tipo inválido', async () => {
    const { token } = await loginAs('admin');
    const res = await generate(token, `Trilha padrão ${uniqueSuffix()}`, { track_type: 'invalido' });
    expect(res.status).toBe(201);
    expect(res.body.data.track_type).toBe('project');
  });

  it('o contexto MCP (banco real) detecta trilha existente com o mesmo nome', async () => {
    const { token } = await loginAs('hr');
    const goal = `Duplicada ${uniqueSuffix()}`;
    await createTrack({ name: `Trilha: ${goal}` });

    const res = await generate(token, goal);

    expect(res.status).toBe(201);
    expect(res.body.data.warnings.map((w: { code: string }) => w.code)).toContain('DUPLICATE_TRACK_NAME');
    expect(res.body.data.status).toBe('pending_review');
  });

  it.each([['curto'], ['x'.repeat(2001)], ['']])('objetivo inválido (%#) → 400 AI_GOAL_INVALID', async (goal) => {
    const { token } = await loginAs('admin');
    const before = await count('api::ai-suggestion.ai-suggestion');
    const res = await generate(token, goal);
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('AI_GOAL_INVALID');
    expect(await count('api::ai-suggestion.ai-suggestion')).toBe(before);
  });

  it('sem objetivo no corpo → 400', async () => {
    const { token } = await loginAs('admin');
    const client = await api();
    const res = await client.post('/api/ai-suggestions').set(authHeader(token)).send({ data: {} });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ai-suggestions — falhas do provedor de IA', () => {
  const cases: Array<[string, string, number, string]> = [
    ['erro do provedor', '[[mock:error]]', 502, 'AI_PROVIDER_ERROR'],
    ['resposta vazia', '[[mock:empty]]', 502, 'AI_EMPTY_RESPONSE'],
    ['resposta que não é JSON', '[[mock:invalid]]', 502, 'AI_RESULT_INVALID'],
    ['dependência inválida', '[[mock:invalid-deps]]', 502, 'AI_RESULT_INVALID'],
    ['timeout', '[[mock:timeout]]', 504, 'AI_PROVIDER_TIMEOUT'],
  ];

  it.each(cases)('%s → %i %s, sem persistir nada e sem vazar detalhes internos', async (_label, marker, status, code) => {
    const { token } = await loginAs('admin');
    const before = await count('api::ai-suggestion.ai-suggestion');

    const res = await generate(token, `Falha simulada ${uniqueSuffix()} ${marker}`);

    expect(res.status).toBe(status);
    expect(res.body.data).toBeNull();
    expect(res.body.error).toMatchObject({ status, name: 'AiFlowError', details: { code } });
    expect(res.body.error.details).not.toHaveProperty('cause');
    expect(await count('api::ai-suggestion.ai-suggestion')).toBe(before);
  });
});

describe('Acesso à API de sugestões', () => {
  it('colaborador não pode gerar nem listar sugestões (403)', async () => {
    const { token } = await loginAs('employee');
    const client = await api();
    expect((await generate(token, `Tentativa ${uniqueSuffix()}`)).status).toBe(403);
    expect((await client.get('/api/ai-suggestions').set(authHeader(token))).status).toBe(403);
  });

  it('sem autenticação não gera sugestão', async () => {
    const client = await api();
    const res = await client.post('/api/ai-suggestions').send({ data: { goal: 'Objetivo sem login algum' } });
    expect([401, 403]).toContain(res.status);
  });

  it('gestão lista e busca uma sugestão por id', async () => {
    const { token } = await loginAs('leadership');
    const goal = `Listagem ${uniqueSuffix()}`;
    const created = await generate(token, goal);
    expect(created.status).toBe(201);

    const client = await api();
    const list = await client.get('/api/ai-suggestions').set(authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body.data.some((item: { goal: string }) => item.goal === goal)).toBe(true);

    const one = await client.get(`/api/ai-suggestions/${created.body.data.documentId}`).set(authHeader(token));
    expect(one.status).toBe(200);
    expect(one.body.data.status).toBe('pending_review');
  });

  it('CRUD genérico não está exposto: não há PUT nem DELETE', async () => {
    const { token } = await loginAs('admin');
    const created = await generate(token, `Sem CRUD ${uniqueSuffix()}`);
    const id = created.body.data.documentId;
    const client = await api();

    const put = await client.put(`/api/ai-suggestions/${id}`).set(authHeader(token)).send({ data: { status: 'approved' } });
    const del = await client.delete(`/api/ai-suggestions/${id}`).set(authHeader(token));
    expect([404, 405]).toContain(put.status);
    expect([404, 405]).toContain(del.status);

    const one = await client.get(`/api/ai-suggestions/${id}`).set(authHeader(token));
    expect(one.body.data.status).toBe('pending_review');
  });
});
