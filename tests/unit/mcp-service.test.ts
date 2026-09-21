import { describe, it, expect, afterEach, vi } from 'vitest';
import { installFakeStrapi, restoreGlobals } from '../helpers/fake-strapi';
import {
  callTool,
  fetchExistingTracksCatalog,
  localTools,
  LIST_EXISTING_TRACKS,
  type McpTool,
} from '../../src/api/ai-suggestion/services/mcp-service';

const local = { transport: 'local', serverUrl: '', timeoutMs: 50 };
const http = { transport: 'http', serverUrl: 'http://mcp.test/rpc', timeoutMs: 50 };

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error) => ({ code: error.code, status: error.status, details: error.details }),
  );

const tool = (handler: McpTool['handler']): Record<string, McpTool> => ({
  [LIST_EXISTING_TRACKS]: { name: LIST_EXISTING_TRACKS, description: '', inputSchema: {}, handler },
});

afterEach(() => {
  restoreGlobals();
  vi.unstubAllGlobals();
});

describe('MCPService — transporte local', () => {
  it('list_existing_tracks consulta as trilhas ativas no banco', async () => {
    installFakeStrapi({
      'api::track.track': [
        { id: 1, name: 'Ativa', description: 'd', track_type: 'project', is_active: true },
        { id: 2, name: 'Sem flag', track_type: 'institutional' },
        { id: 3, name: 'Desativada', is_active: false },
      ],
    });
    const catalog = await fetchExistingTracksCatalog(local);
    expect(catalog.map((entry) => entry.name)).toEqual(['Ativa', 'Sem flag']);
  });

  it('ferramenta desconhecida: MCP_TOOL_UNAVAILABLE', async () => {
    expect(await codeOf(callTool('nao_existe', {}, local, { tools: {} }))).toMatchObject({
      code: 'MCP_TOOL_UNAVAILABLE',
      status: 502,
    });
  });

  it('handler que lança: MCP_TOOL_UNAVAILABLE (sem vazar a exceção)', async () => {
    const tools = tool(async () => {
      throw new Error('db caiu');
    });
    expect((await codeOf(callTool(LIST_EXISTING_TRACKS, {}, local, { tools })))?.code).toBe('MCP_TOOL_UNAVAILABLE');
  });

  it('handler lento: MCP_TIMEOUT (504)', async () => {
    const tools = tool(() => new Promise(() => {}));
    expect(await codeOf(callTool(LIST_EXISTING_TRACKS, {}, { ...local, timeoutMs: 20 }, { tools }))).toMatchObject({
      code: 'MCP_TIMEOUT',
      status: 504,
    });
  });

  it('transporte desconhecido: MCP_TOOL_UNAVAILABLE', async () => {
    expect((await codeOf(callTool('x', {}, { ...local, transport: 'ws' })))?.code).toBe('MCP_TOOL_UNAVAILABLE');
  });

  it('expõe o contrato de ferramenta MCP (nome, descrição, JSON Schema)', () => {
    expect(localTools[LIST_EXISTING_TRACKS]).toMatchObject({
      name: LIST_EXISTING_TRACKS,
      inputSchema: { type: 'object' },
    });
  });
});

describe('MCPService — validação do catálogo retornado', () => {
  const catalogOf = (payload: unknown) =>
    fetchExistingTracksCatalog(local, { tools: tool(async () => payload) });

  it('aceita { tracks: [...] } e lista direta, higieniza e limita', async () => {
    expect(await catalogOf([{ name: '  A  ', description: 5 }])).toEqual([
      { name: 'A', description: null, track_type: null },
    ]);
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `T${i}` }));
    expect(await catalogOf({ tracks: many })).toHaveLength(50);
  });

  it.each([
    ['nem lista nem { tracks }', { foo: 1 }],
    ['null', null],
    ['entrada sem nome', { tracks: [{ description: 'x' }] }],
    ['nome vazio', { tracks: [{ name: '  ' }] }],
  ])('formato inválido (%s): MCP_INVALID_RESPONSE', async (_label, payload) => {
    expect((await codeOf(catalogOf(payload)))?.code).toBe('MCP_INVALID_RESPONSE');
  });
});

describe('MCPService — transporte http (JSON-RPC tools/call)', () => {
  const stubFetch = (impl: (...args: any[]) => any) => {
    const fn = vi.fn(impl);
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  const json = (body: unknown, init: ResponseInit = { status: 200 }) => new Response(JSON.stringify(body), init);

  it('envia a chamada JSON-RPC e lê structuredContent', async () => {
    const fetchMock = stubFetch(async () =>
      json({ jsonrpc: '2.0', id: 1, result: { structuredContent: { tracks: [{ name: 'Remota' }] } } }),
    );
    const catalog = await fetchExistingTracksCatalog(http);
    expect(catalog.map((entry) => entry.name)).toEqual(['Remota']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://mcp.test/rpc');
    expect(JSON.parse(init.body)).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: LIST_EXISTING_TRACKS },
    });
  });

  it('lê o JSON dentro de content[].text', async () => {
    stubFetch(async () =>
      json({ result: { content: [{ type: 'text', text: JSON.stringify({ tracks: [{ name: 'Via texto' }] }) }] } }),
    );
    expect((await fetchExistingTracksCatalog(http))[0].name).toBe('Via texto');
  });

  it('sem MCP_SERVER_URL: indisponível', async () => {
    expect((await codeOf(callTool('x', {}, { ...http, serverUrl: '' })))?.code).toBe('MCP_TOOL_UNAVAILABLE');
  });

  it('erro de rede: MCP_TOOL_UNAVAILABLE', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect((await codeOf(callTool('x', {}, http)))?.code).toBe('MCP_TOOL_UNAVAILABLE');
  });

  it('HTTP não-2xx: indisponível com o status', async () => {
    stubFetch(async () => json({}, { status: 503 }));
    expect(await codeOf(callTool('x', {}, http))).toMatchObject({
      code: 'MCP_TOOL_UNAVAILABLE',
      details: { upstreamStatus: 503 },
    });
  });

  it('erro JSON-RPC ou isError: indisponível', async () => {
    stubFetch(async () => json({ error: { code: -32601, message: 'method not found' } }));
    expect((await codeOf(callTool('x', {}, http)))?.code).toBe('MCP_TOOL_UNAVAILABLE');
    stubFetch(async () => json({ result: { isError: true, content: [] } }));
    expect((await codeOf(callTool('x', {}, http)))?.code).toBe('MCP_TOOL_UNAVAILABLE');
  });

  it('corpo que não é JSON, resultado vazio ou texto que não é JSON: MCP_INVALID_RESPONSE', async () => {
    stubFetch(async () => new Response('<html>', { status: 200 }));
    expect((await codeOf(callTool('x', {}, http)))?.code).toBe('MCP_INVALID_RESPONSE');
    stubFetch(async () => json({ result: null }));
    expect((await codeOf(callTool('x', {}, http)))?.code).toBe('MCP_INVALID_RESPONSE');
    stubFetch(async () => json({ result: { content: [] } }));
    expect((await codeOf(callTool('x', {}, http)))?.code).toBe('MCP_INVALID_RESPONSE');
    stubFetch(async () => json({ result: { content: [{ type: 'text', text: 'não é json' }] } }));
    expect((await codeOf(callTool('x', {}, http)))?.code).toBe('MCP_INVALID_RESPONSE');
  });

  it('servidor lento: MCP_TIMEOUT e a requisição é abortada', async () => {
    let aborted = false;
    stubFetch(
      (_url: string, init: RequestInit) =>
        new Promise(() => {
          init.signal?.addEventListener('abort', () => (aborted = true));
        }),
    );
    expect(await codeOf(callTool('x', {}, { ...http, timeoutMs: 20 }))).toMatchObject({ code: 'MCP_TIMEOUT' });
    expect(aborted).toBe(true);
  });
});
