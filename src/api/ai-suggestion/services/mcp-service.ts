import type { UID } from '@strapi/types';

import { AiFlowError, runWithTimeout } from './ai-errors';
import type { AiConfig, CatalogEntry } from './ai-types';

/** Contrato de ferramenta no estilo MCP: nome, descrição, JSON Schema de entrada e handler. */
export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const MAX_CATALOG_ENTRIES = 50;

export const LIST_EXISTING_TRACKS = 'list_existing_tracks';

/** Ferramentas em processo (transporte "local"). */
export const localTools: Record<string, McpTool> = {
  [LIST_EXISTING_TRACKS]: {
    name: LIST_EXISTING_TRACKS,
    description: 'Lista as trilhas ativas já cadastradas, para a IA evitar duplicidade.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: MAX_CATALOG_ENTRIES } },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || MAX_CATALOG_ENTRIES, MAX_CATALOG_ENTRIES);
      const tracks = await strapi.db.query('api::track.track' as UID.ContentType).findMany({
        where: { is_active: { $ne: false } },
        select: ['name', 'description', 'track_type'],
        orderBy: { createdAt: 'desc' },
        limit,
      });
      return { tracks };
    },
  },
};

type McpConfig = AiConfig['mcp'];

type CallDeps = { tools?: Record<string, McpTool> };

const unavailable = (tool: string, details: Record<string, unknown> = {}) =>
  new AiFlowError('MCP_TOOL_UNAVAILABLE', `Ferramenta MCP indisponível: ${tool}`, { tool, ...details });

const timeoutError = (tool: string, timeoutMs: number) =>
  new AiFlowError('MCP_TIMEOUT', `Tempo esgotado ao chamar a ferramenta MCP: ${tool}`, {
    tool,
    timeoutMs,
  });

const callLocal = async (
  name: string,
  args: Record<string, unknown>,
  config: McpConfig,
  tools: Record<string, McpTool>
) => {
  const tool = tools[name];
  if (!tool) {
    throw unavailable(name, { reason: 'unknown_tool' });
  }

  try {
    return await runWithTimeout(
      config.timeoutMs,
      () => tool.handler(args),
      () => timeoutError(name, config.timeoutMs)
    );
  } catch (error) {
    if (error instanceof AiFlowError) {
      throw error;
    }
    throw unavailable(name, { cause: error instanceof Error ? error.message : String(error) });
  }
};

/** Extrai o payload de um resultado `tools/call` do MCP (structuredContent ou texto JSON). */
const unwrapRpcResult = (name: string, result: unknown): unknown => {
  if (typeof result !== 'object' || result === null) {
    throw new AiFlowError('MCP_INVALID_RESPONSE', 'Resposta MCP inválida', { tool: name });
  }

  const record = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };

  if (record.isError) {
    throw unavailable(name, { reason: 'tool_error' });
  }
  if (record.structuredContent !== undefined) {
    return record.structuredContent;
  }

  const text = record.content?.find((item) => item?.type === 'text')?.text;
  if (typeof text !== 'string') {
    throw new AiFlowError('MCP_INVALID_RESPONSE', 'Resposta MCP sem conteúdo utilizável', { tool: name });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AiFlowError('MCP_INVALID_RESPONSE', 'Conteúdo da resposta MCP não é JSON', { tool: name });
  }
};

const callHttp = async (name: string, args: Record<string, unknown>, config: McpConfig) => {
  if (!config.serverUrl) {
    throw unavailable(name, { reason: 'MCP_SERVER_URL não configurada' });
  }

  return runWithTimeout(
    config.timeoutMs,
    async (signal) => {
      let response: Response;
      try {
        response = await fetch(config.serverUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
          signal,
        });
      } catch (error) {
        throw unavailable(name, { cause: error instanceof Error ? error.message : String(error) });
      }

      if (!response.ok) {
        throw unavailable(name, { upstreamStatus: response.status });
      }

      let body: { result?: unknown; error?: unknown };
      try {
        body = (await response.json()) as typeof body;
      } catch {
        throw new AiFlowError('MCP_INVALID_RESPONSE', 'Resposta MCP não é JSON', { tool: name });
      }

      if (body?.error) {
        throw unavailable(name, { reason: 'rpc_error' });
      }

      return unwrapRpcResult(name, body?.result);
    },
    () => timeoutError(name, config.timeoutMs)
  );
};

/**
 * MCPService — ponto único de chamada de ferramentas para a IA.
 *
 * Transportes: "local" (registro em processo) ou "http" (servidor MCP externo,
 * JSON-RPC `tools/call`, resposta única — sem handshake `initialize` nem
 * sessões/streaming). Toda falha vira `AiFlowError` (indisponível, timeout ou
 * resposta inválida); quem chama decide se degrada ou aborta.
 */
export const callTool = async (
  name: string,
  args: Record<string, unknown>,
  config: McpConfig,
  deps: CallDeps = {}
): Promise<unknown> => {
  switch (config.transport) {
    case 'local':
      return callLocal(name, args, config, deps.tools ?? localTools);
    case 'http':
      return callHttp(name, args, config);
    default:
      throw unavailable(name, { reason: `transporte desconhecido: ${config.transport}` });
  }
};

/** Chama `list_existing_tracks` e valida o formato do retorno. */
export const fetchExistingTracksCatalog = async (
  config: McpConfig,
  deps: CallDeps = {}
): Promise<CatalogEntry[]> => {
  const result = await callTool(LIST_EXISTING_TRACKS, { limit: MAX_CATALOG_ENTRIES }, config, deps);

  const list = Array.isArray(result) ? result : (result as { tracks?: unknown } | null)?.tracks;
  if (!Array.isArray(list)) {
    throw new AiFlowError('MCP_INVALID_RESPONSE', 'Catálogo de trilhas em formato inválido', {
      tool: LIST_EXISTING_TRACKS,
    });
  }

  return list.slice(0, MAX_CATALOG_ENTRIES).map((entry, index) => {
    if (typeof entry?.name !== 'string' || entry.name.trim() === '') {
      throw new AiFlowError('MCP_INVALID_RESPONSE', 'Entrada de catálogo sem nome', {
        tool: LIST_EXISTING_TRACKS,
        index,
      });
    }
    return {
      name: entry.name.trim().slice(0, 200),
      description: typeof entry.description === 'string' ? entry.description.slice(0, 300) : null,
      track_type: typeof entry.track_type === 'string' ? entry.track_type : null,
    };
  });
};
