import type { Core } from '@strapi/strapi';

// Configuração da camada de IA/MCP. Tudo vem de variáveis de ambiente — nenhum
// segredo no repositório e nada disto é exposto ao frontend. Sem chave de API o
// padrão é o provedor "mock" (modo de desenvolvimento seguro e determinístico).
const config = ({ env }: Core.Config.Shared.ConfigParams) => ({
  provider: env('AI_PROVIDER', 'mock') as string,
  model: env('AI_MODEL', 'claude-opus-5') as string,
  apiKey: env('ANTHROPIC_API_KEY', '') as string,
  timeoutMs: env.int('AI_TIMEOUT_MS', 60_000),
  mcp: {
    // "local": ferramentas registradas em processo (padrão).
    // "http":  servidor MCP externo via JSON-RPC (`tools/call`) em MCP_SERVER_URL.
    transport: env('MCP_TRANSPORT', 'local') as string,
    serverUrl: env('MCP_SERVER_URL', '') as string,
    timeoutMs: env.int('MCP_TIMEOUT_MS', 5_000),
  },
});

export default config;
