import path from 'node:path';
import dotenv from 'dotenv';
import type { Core } from '@strapi/strapi';

// Carrega .env.test ANTES de qualquer coisa importar @strapi/strapi — a
// schema isolada (pitang_test) e os secrets precisam estar no process.env
// antes do boot. `override: true` porque um processo anterior pode ter
// deixado variáveis de outro .env carregadas.
dotenv.config({ path: path.resolve(__dirname, '../../.env.test'), override: true });
process.env.NODE_ENV = 'test';
process.env.SKIP_APP_BOOTSTRAP = 'true';

// A suíte nunca pode chamar um provedor de IA real (custo, rede, segredo): força
// o provedor mock e um timeout curto para o cenário [[mock:timeout]].
process.env.AI_PROVIDER = 'mock';
process.env.ANTHROPIC_API_KEY = '';
process.env.AI_TIMEOUT_MS = '1500';
process.env.MCP_TRANSPORT = 'local';

if (process.env.DATABASE_SCHEMA !== 'pitang_test') {
  throw new Error(
    `Testes exigem DATABASE_SCHEMA=pitang_test (isolado dos dados de demo). ` +
      `Valor atual: "${process.env.DATABASE_SCHEMA}". Verifique .env.test.`,
  );
}

let bootPromise: Promise<Core.Strapi> | null = null;

/**
 * Cria a schema `pitang_test` se ainda não existir. O Strapi cria as
 * tabelas dentro da schema configurada, mas não cria a schema em si.
 */
async function ensureTestSchemaExists(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Client } = require('pg');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined,
  });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${process.env.DATABASE_SCHEMA}"`);
  } finally {
    await client.end();
  }
}

/**
 * Boota UMA instância Strapi compartilhada por toda a suíte (custa ~20-30s).
 * Chamadas subsequentes retornam a mesma instância — nunca reboota.
 */
export function getTestStrapi(): Promise<Core.Strapi> {
  if (!bootPromise) {
    bootPromise = (async () => {
      await ensureTestSchemaExists();

      // require() (não import dinâmico) — a build ESM do pacote quebra a
      // resolução de `lodash/fp` sob o resolvedor estrito do Node.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { compileStrapi, createStrapi } = require('@strapi/strapi');
      const appContext = await compileStrapi();
      const instance = (await createStrapi(appContext).load()) as Core.Strapi;

      // `.load()` registra as rotas (initRouting) mas só as conecta na app
      // Koa dentro de `mount()`, que normalmente só roda via `.listen()`.
      // Como os testes usam o httpServer sem abrir porta de verdade,
      // precisamos montar manualmente — sem isso toda rota cai em 404.
      instance.server.mount();

      const { seedUsersPermissions } = await import('../../src/bootstrap/users-permissions');
      await seedUsersPermissions(instance);

      return instance;
    })();
  }
  return bootPromise;
}

export async function destroyTestStrapi(): Promise<void> {
  if (!bootPromise) return;
  const instance = await bootPromise;
  await instance.destroy();
  bootPromise = null;
}
