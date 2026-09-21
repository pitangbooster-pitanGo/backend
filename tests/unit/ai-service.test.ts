import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { getProvider, requestStructure } from '../../src/api/ai-suggestion/services/ai-service';
import { createAnthropicProvider } from '../../src/api/ai-suggestion/services/anthropic-provider';
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
  it('resolve mock e anthropic; provedor desconhecido é AI_NOT_CONFIGURED', () => {
    expect(getProvider(config({ provider: 'mock' })).name).toBe('mock');
    expect(getProvider(config({ provider: 'anthropic' })).name).toBe('anthropic');
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
