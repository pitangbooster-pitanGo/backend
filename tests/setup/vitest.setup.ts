import { beforeAll } from 'vitest';
import { getTestStrapi } from './strapi-instance';

// Executa antes de cada arquivo de teste, mas `getTestStrapi()` boota a
// instância Strapi só uma vez (singleton em strapi-instance.ts) — os
// arquivos seguintes reaproveitam a mesma instância e o mesmo schema
// (pitang_test). O processo do Vitest encerra ao final da suíte, fechando
// a conexão com o banco junto.
beforeAll(async () => {
  await getTestStrapi();
}, 300_000);
