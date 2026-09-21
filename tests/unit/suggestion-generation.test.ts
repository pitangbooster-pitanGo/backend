import { describe, it, expect, afterEach } from 'vitest';
import { installFakeStrapi, restoreGlobals } from '../helpers/fake-strapi';
import { generateSuggestionDraft } from '../../src/api/ai-suggestion/services/suggestion-generation';
import { mockProvider } from '../../src/api/ai-suggestion/services/mock-provider';
import { LIST_EXISTING_TRACKS, type McpTool } from '../../src/api/ai-suggestion/services/mcp-service';
import type { AiConfig, AiProvider } from '../../src/api/ai-suggestion/services/ai-types';

const config: AiConfig = {
  provider: 'mock',
  model: 'claude-opus-5',
  apiKey: '',
  timeoutMs: 50,
  mcp: { transport: 'local', serverUrl: '', timeoutMs: 50 },
};

const catalogTool = (handler: McpTool['handler']): Record<string, McpTool> => ({
  [LIST_EXISTING_TRACKS]: { name: LIST_EXISTING_TRACKS, description: '', inputSchema: {}, handler },
});

const input = { goal: 'Onboarding de backend', trackType: 'project' as const };
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error) => error.code,
  );

afterEach(restoreGlobals);

describe('generateSuggestionDraft — fluxo MCP → IA → validador', () => {
  it('sucesso: devolve um rascunho validado, sem tocar em trilhas/tarefas', async () => {
    const { tables } = installFakeStrapi({ 'api::track.track': [] });
    const draft = await generateSuggestionDraft(input, config, {
      provider: mockProvider,
      mcpTools: catalogTool(async () => ({ tracks: [] })),
    });

    expect(draft.provider).toBe('mock');
    expect(draft.structure.tasks).toHaveLength(5);
    expect(draft.warnings).toEqual([]);
    // Nenhuma escrita: o rascunho é só uma proposta.
    expect(tables['api::track.track']).toEqual([]);
    expect(tables['api::task.task']).toBeUndefined();
  });

  it('o catálogo do MCP chega ao provedor e gera aviso de duplicidade', async () => {
    installFakeStrapi();
    let seen: string[] = [];
    const spy: AiProvider = {
      name: 'spy',
      generate: async (request, ctx) => {
        seen = request.existingTracks.map((track) => track.name);
        return mockProvider.generate(request, ctx);
      },
    };
    const draft = await generateSuggestionDraft(input, config, {
      provider: spy,
      mcpTools: catalogTool(async () => ({ tracks: [{ name: 'Trilha: Onboarding de backend' }] })),
    });

    expect(seen).toEqual(['Trilha: Onboarding de backend']);
    expect(draft.warnings.map((w) => w.code)).toEqual(['DUPLICATE_TRACK_NAME']);
  });

  it.each([
    ['ferramenta lança', async () => { throw new Error('db'); }, 'MCP_TOOL_UNAVAILABLE'],
    ['ferramenta devolve formato inválido', async () => ({ nope: true }), 'MCP_INVALID_RESPONSE'],
    ['ferramenta trava', () => new Promise(() => {}), 'MCP_TIMEOUT'],
  ])('falha do MCP (%s): degrada com aviso e ainda gera a sugestão', async (_label, handler, code) => {
    const { db } = installFakeStrapi();
    const draft = await generateSuggestionDraft(input, { ...config, mcp: { ...config.mcp, timeoutMs: 20 } }, {
      provider: mockProvider,
      mcpTools: catalogTool(handler as McpTool['handler']),
    });

    expect(draft.structure.tasks.length).toBeGreaterThan(0);
    expect(draft.warnings[0]).toMatchObject({ code: 'MCP_CONTEXT_UNAVAILABLE' });
    expect(draft.warnings[0].message).toContain(code);
    void db;
  });

  it('falha da IA (exceção, timeout, vazio) interrompe o fluxo com o código certo', async () => {
    installFakeStrapi();
    const mcpTools = catalogTool(async () => ({ tracks: [] }));
    const run = (generate: AiProvider['generate']) =>
      codeOf(generateSuggestionDraft(input, { ...config, timeoutMs: 20 }, { provider: { name: 'f', generate }, mcpTools }));

    expect(await run(async () => { throw new Error('x'); })).toBe('AI_PROVIDER_ERROR');
    expect(await run(() => new Promise(() => {}))).toBe('AI_PROVIDER_TIMEOUT');
    expect(await run(async () => ({ text: '', model: 'm' }))).toBe('AI_EMPTY_RESPONSE');
  });

  it('resposta inválida da IA é rejeitada pelo validador — nunca vira rascunho', async () => {
    installFakeStrapi();
    const mcpTools = catalogTool(async () => ({ tracks: [] }));
    const garbage: AiProvider = { name: 'g', generate: async () => ({ text: 'não é json', model: 'm' }) };
    expect(await codeOf(generateSuggestionDraft(input, config, { provider: garbage, mcpTools }))).toBe(
      'AI_RESULT_INVALID',
    );
  });
});
