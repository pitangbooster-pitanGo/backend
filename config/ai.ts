import type { Core } from '@strapi/strapi';

// Configuração da camada de IA/MCP. Tudo vem de variáveis de ambiente — nenhum
// segredo no repositório e nada disto é exposto ao frontend. Sem chave de API o
// padrão é o provedor "mock" (modo de desenvolvimento seguro e determinístico).
const config = ({ env }: Core.Config.Shared.ConfigParams) => {
  const provider = env('AI_PROVIDER', 'mock') as string;

  return {
    provider,
    // AI_MODEL segue sendo a única forma de escolher o modelo; o que acompanha
    // o provedor é o padrão — senão AI_PROVIDER=gemini herdaria um nome de
    // modelo da Anthropic e falharia na primeira chamada.
    model: env('AI_MODEL', provider === 'gemini' ? 'gemini-3.8-flash' : 'claude-opus-5') as string,
    apiKey: env('ANTHROPIC_API_KEY', '') as string,
    geminiApiKey: env('GEMINI_API_KEY', '') as string,
    timeoutMs: env.int('AI_TIMEOUT_MS', 60_000),
    mcp: {
      // "local": ferramentas registradas em processo (padrão).
      // "http":  servidor MCP externo via JSON-RPC (`tools/call`) em MCP_SERVER_URL.
      transport: env('MCP_TRANSPORT', 'local') as string,
      serverUrl: env('MCP_SERVER_URL', '') as string,
      timeoutMs: env.int('MCP_TIMEOUT_MS', 5_000),
    },
  };
};

export default config;
