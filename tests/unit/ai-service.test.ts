import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { getProvider, requestStructure } from '../../src/api/ai-suggestion/services/ai-service';
import { createAnthropicProvider } from '../../src/api/ai-suggestion/services/anthropic-provider';
import { createGeminiProvider } from '../../src/api/ai-suggestion/services/gemini-provider';
import { mockProvider } from '../../src/api/ai-suggestion/services/mock-provider';
import { validateAiResult } from '../../src/api/ai-suggestion/services/ai-result-validator';
import type { AiConfig, AiProvider, ProviderRequest } from '../../src/api/ai-suggestion/services/ai-types';

const config = (overrides: Partial<AiConfig> = {}): AiConfig => ({
  provider: 'mock',
  model: 'claude-opus-5',
  apiKey: '',
  timeoutMs: 50,
  mcp: { transport: 'local', serverUrl: '', timeoutMs: 50 },
  ...overrides,
});

const request = (goal = 'Onboarding de backend'): ProviderRequest => ({
  goal,
  trackType: 'project',
  existingTracks: [],
  maxTasks: 20,
});

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error) => ({ code: error.code, status: error.status, details: error.details }),
  );

const provider = (generate: AiProvider['generate']): AiProvider => ({ name: 'fake', generate });

describe('AIService.requestStructure — tratamento de falhas do provedor', () => {
  it('sucesso: devolve texto bruto, provedor e modelo', async () => {
    const result = await requestStructure(request(), config(), provider(async () => ({ text: '{"a":1}', model: 'm1' })));
    expect(result).toEqual({ raw: '{"a":1}', provider: 'fake', model: 'm1' });
  });

  it('timeout: AI_PROVIDER_TIMEOUT (504) mesmo se o provedor ignorar o AbortSignal', async () => {
    const hang = provider(() => new Promise(() => {}));
    expect(await codeOf(requestStructure(request(), config({ timeoutMs: 20 }), hang))).toMatchObject({
      code: 'AI_PROVIDER_TIMEOUT',
      status: 504,
    });
  });

  it('o AbortSignal é acionado no timeout', async () => {
    let aborted = false;
    const hang = provider((_req, { signal }) => {
      signal.addEventListener('abort', () => (aborted = true));
      return new Promise(() => {});
    });
    await codeOf(requestStructure(request(), config({ timeoutMs: 20 }), hang));
    expect(aborted).toBe(true);
  });

  it('exceção inesperada do provedor vira AI_PROVIDER_ERROR (502)', async () => {
    const boom = provider(async () => {
      throw new Error('ECONNRESET');
    });
    expect(await codeOf(requestStructure(request(), config(), boom))).toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      status: 502,
    });
  });

  it.each([[''], ['   \n'], [undefined as unknown as string]])('resposta vazia (%j): AI_EMPTY_RESPONSE', async (text) => {
    const empty = provider(async () => ({ text, model: 'm' }));
    expect(await codeOf(requestStructure(request(), config(), empty))).toMatchObject({
      code: 'AI_EMPTY_RESPONSE',
      status: 502,
    });
  });

  it('erro já tipado do provedor é repassado sem ser reembrulhado', async () => {
    const { AiFlowError } = await import('../../src/api/ai-suggestion/services/ai-errors');
    const typed = provider(async () => {
      throw new AiFlowError('AI_NOT_CONFIGURED', 'x');
    });
    expect((await codeOf(requestStructure(request(), config(), typed)))?.code).toBe('AI_NOT_CONFIGURED');
  });
});

describe('getProvider', () => {
  it('resolve mock, anthropic e gemini; provedor desconhecido é AI_NOT_CONFIGURED', () => {
    expect(getProvider(config({ provider: 'mock' })).name).toBe('mock');
    expect(getProvider(config({ provider: 'anthropic' })).name).toBe('anthropic');
    expect(getProvider(config({ provider: 'gemini' })).name).toBe('gemini');
    expect(() => getProvider(config({ provider: 'gpt' }))).toThrowError(/desconhecido/);
  });
});

describe('mockProvider', () => {
  const run = (goal: string) => mockProvider.generate(request(goal), { signal: new AbortController().signal });

  it('gera uma estrutura determinística que passa pelo AIResultValidator', async () => {
    const { text } = await run('Onboarding de backend');
    const again = await run('Onboarding de backend');
    expect(text).toBe(again.text);
    const { structure } = validateAiResult(text, { trackType: 'project' });
    expect(structure.tasks).toHaveLength(5);
    expect(structure.track.name).toBe('Trilha: Onboarding de backend');
  });

  it('respeita maxTasks', async () => {
    const { text } = await mockProvider.generate({ ...request(), maxTasks: 2 }, { signal: new AbortController().signal });
    expect(JSON.parse(text).tasks).toHaveLength(2);
  });

  it('marcadores simulam falhas (e são removidos do nome da trilha)', async () => {
    await expect(run('teste [[mock:error]]')).rejects.toThrow('simulada');
    expect((await run('teste [[mock:empty]]')).text).toBe('');
    const bad = await run('teste [[mock:invalid]]');
    expect(() => validateAiResult(bad.text, { trackType: 'project' })).toThrow();
    const deps = await run('teste [[mock:invalid-deps]] x');
    expect(() => validateAiResult(deps.text, { trackType: 'project' })).toThrowError(/formato esperado/);
  });
});

describe('Anthropic provider (SDK oficial, cliente injetado)', () => {
  const message = (overrides: Record<string, unknown> = {}) => ({
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"ok":' }, { type: 'text', text: 'true}' }],
    ...overrides,
  });
  const withClient = (create: ReturnType<typeof vi.fn>, cfg = config({ provider: 'anthropic', apiKey: 'k' })) =>
    createAnthropicProvider(cfg, () => ({ messages: { create } }));
  const call = (p: AiProvider) => p.generate(request(), { signal: new AbortController().signal });

  it('sem chave: AI_NOT_CONFIGURED e nenhum cliente é criado', async () => {
    const makeClient = vi.fn();
    const p = createAnthropicProvider(config({ provider: 'anthropic', apiKey: '' }), makeClient);
    expect(await codeOf(call(p))).toMatchObject({ code: 'AI_NOT_CONFIGURED', status: 503 });
    expect(makeClient).not.toHaveBeenCalled();
  });

  it('envia modelo, system prompt e o objetivo delimitado; concatena blocos de texto', async () => {
    const create = vi.fn().mockResolvedValue(message());
    const result = await call(withClient(create));
    expect(result).toEqual({ text: '{"ok":true}', model: 'claude-opus-5' });

    const [body, options] = create.mock.calls[0];
    expect(body.model).toBe('claude-opus-5');
    expect(body.system).toContain('SOMENTE com um objeto JSON');
    expect(body.messages[0].content).toContain('<objetivo>\nOnboarding de backend\n</objetivo>');
    expect(options.timeout).toBe(50);
  });

  it('a chave nunca vai no corpo da requisição ou no prompt', async () => {
    const create = vi.fn().mockResolvedValue(message());
    await call(withClient(create, config({ provider: 'anthropic', apiKey: 'sk-ant-segredo' })));
    expect(JSON.stringify(create.mock.calls[0])).not.toContain('sk-ant-segredo');
  });

  it('stop_reason=refusal vira AI_PROVIDER_ERROR', async () => {
    const create = vi.fn().mockResolvedValue(message({ stop_reason: 'refusal' }));
    expect(await codeOf(call(withClient(create)))).toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      details: { reason: 'refusal' },
    });
  });

  it('timeout do SDK vira AI_PROVIDER_TIMEOUT', async () => {
    const create = vi.fn().mockRejectedValue(new Anthropic.APIConnectionTimeoutError());
    expect(await codeOf(call(withClient(create)))).toMatchObject({ code: 'AI_PROVIDER_TIMEOUT', status: 504 });
  });

  it('erro HTTP do SDK vira AI_PROVIDER_ERROR expondo só o status, não o corpo', async () => {
    const apiError = Anthropic.APIError.generate(
      429,
      { error: { message: 'rate limited com detalhes internos' } },
      'rate limited com detalhes internos',
      new Headers(),
    );
    const create = vi.fn().mockRejectedValue(apiError);
    const result = await codeOf(call(withClient(create)));
    expect(result).toMatchObject({ code: 'AI_PROVIDER_ERROR', details: { upstreamStatus: 429 } });
    expect(JSON.stringify(result)).not.toContain('detalhes internos');
  });

  it('erro desconhecido é repassado (o AIService o classifica)', async () => {
    const create = vi.fn().mockRejectedValue(new TypeError('bug'));
    await expect(call(withClient(create))).rejects.toThrow('bug');
  });
});

describe('Gemini provider (REST v1beta, fetch injetado)', () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    modelVersion: 'gemini-3.8-flash',
    candidates: [
      {
        finishReason: 'STOP',
        content: { parts: [{ text: '{"ok":' }, { text: 'true}' }] },
      },
    ],
    ...overrides,
  });
  const ok = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });
  const cfg = (overrides: Partial<AiConfig> = {}) =>
    config({ provider: 'gemini', model: 'gemini-3.8-flash', geminiApiKey: 'k', ...overrides });
  const withFetch = (fetchImpl: ReturnType<typeof vi.fn>, c = cfg()) =>
    createGeminiProvider(c, fetchImpl as never);
  const call = (p: AiProvider) => p.generate(request(), { signal: new AbortController().signal });

  it('sem chave: AI_NOT_CONFIGURED e nenhuma requisição é feita', async () => {
    const fetchImpl = vi.fn();
    const p = createGeminiProvider(cfg({ geminiApiKey: '' }), fetchImpl as never);
    expect(await codeOf(call(p))).toMatchObject({ code: 'AI_NOT_CONFIGURED', status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('GEMINI_API_KEY é usada mesmo com ANTHROPIC_API_KEY vazia', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(body()));
    await call(withFetch(fetchImpl, cfg({ apiKey: '' })));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('usa AI_MODEL na URL, manda system prompt e objetivo; concatena as partes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(body()));
    const result = await call(withFetch(fetchImpl));
    expect(result).toEqual({ text: '{"ok":true}', model: 'gemini-3.8-flash' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body);
    expect(sent.systemInstruction.parts[0].text).toContain('SOMENTE com um objeto JSON');
    expect(sent.contents[0].parts[0].text).toContain('<objetivo>\nOnboarding de backend\n</objetivo>');
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
  });

  it('um AI_MODEL diferente troca o modelo na URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(body({ modelVersion: undefined })));
    const result = await call(withFetch(fetchImpl, cfg({ model: 'gemini-2.5-pro' })));
    expect(fetchImpl.mock.calls[0][0]).toContain('/models/gemini-2.5-pro:generateContent');
    // Sem modelVersion na resposta, o modelo pedido é o reportado.
    expect(result.model).toBe('gemini-2.5-pro');
  });

  it('a chave vai no cabeçalho e nunca na URL nem no corpo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(body()));
    await call(withFetch(fetchImpl, cfg({ geminiApiKey: 'AIza-segredo' })));
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.headers['x-goog-api-key']).toBe('AIza-segredo');
    expect(url).not.toContain('AIza-segredo');
    expect(init.body).not.toContain('AIza-segredo');
  });

  it('promptFeedback.blockReason vira AI_PROVIDER_ERROR de recusa', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(body({ promptFeedback: { blockReason: 'SAFETY' } })));
    expect(await codeOf(call(withFetch(fetchImpl)))).toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      details: { reason: 'refusal' },
    });
  });

  it('finishReason de bloqueio vira AI_PROVIDER_ERROR de recusa', async () => {
    const blocked = body({ candidates: [{ finishReason: 'PROHIBITED_CONTENT', content: { parts: [] } }] });
    const fetchImpl = vi.fn().mockResolvedValue(ok(blocked));
    expect(await codeOf(call(withFetch(fetchImpl)))).toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      details: { reason: 'refusal' },
    });
  });

  it('erro HTTP expõe só o status, não o corpo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'quota com detalhes internos' } }),
    });
    const result = await codeOf(call(withFetch(fetchImpl)));
    expect(result).toMatchObject({ code: 'AI_PROVIDER_ERROR', details: { upstreamStatus: 429 } });
    expect(JSON.stringify(result)).not.toContain('detalhes internos');
  });

  it('abort vira AI_PROVIDER_TIMEOUT', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn().mockRejectedValue(abortError);
    expect(await codeOf(call(withFetch(fetchImpl)))).toMatchObject({
      code: 'AI_PROVIDER_TIMEOUT',
      status: 504,
    });
  });

  it('corpo ilegível vira AI_PROVIDER_ERROR', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('not json');
      },
    });
    expect(await codeOf(call(withFetch(fetchImpl)))).toMatchObject({ code: 'AI_PROVIDER_ERROR' });
  });

  it('resposta sem candidatos devolve texto vazio (o AIService vira AI_EMPTY_RESPONSE)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ candidates: [] }));
    expect((await call(withFetch(fetchImpl))).text).toBe('');
    expect(await codeOf(requestStructure(request(), cfg(), withFetch(fetchImpl)))).toMatchObject({
      code: 'AI_EMPTY_RESPONSE',
    });
  });

  it('falha de rede é repassada (o AIService a classifica)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(call(withFetch(fetchImpl))).rejects.toThrow('fetch failed');
  });

  it('o texto gerado passa pelo AIResultValidator como o de qualquer provedor', async () => {
    const structure = JSON.parse((await mockProvider.generate(request(), { signal: new AbortController().signal })).text);
    const fetchImpl = vi.fn().mockResolvedValue(
      ok(body({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(structure) }] } }] })),
    );
    const { text } = await call(withFetch(fetchImpl));
    expect(validateAiResult(text, { trackType: 'project' }).structure.tasks).toHaveLength(5);
  });
});
