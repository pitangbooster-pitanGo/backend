import { vi } from 'vitest';

type Row = Record<string, any>;
type Where = Record<string, any> | undefined;

/**
 * Banco em memória mínimo para testes de unidade das regras de negócio que só
 * dependem de `strapi.db.query(uid).{findOne,findMany,update}`.
 *
 * `where` suporta igualdade rasa e relações aninhadas por `{ campo: { id } }`
 * — o suficiente para os serviços testados. Não é um ORM: se um teste precisar
 * de mais que isso, ele provavelmente pertence à suíte de integração.
 */
const matches = (row: Row, where: Where): boolean => {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$ne' in expected) return actual !== expected.$ne;
      return actual != null && matches(actual, expected);
    }
    return actual === expected;
  });
};

export function installFakeStrapi(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [uid, rows] of Object.entries(initial)) {
    tables[uid] = rows.map((row) => ({ ...row }));
  }

  const query = (uid: string) => {
    const rows = () => (tables[uid] ??= []);
    return {
      findOne: vi.fn(async ({ where }: { where?: Where }) => rows().find((r) => matches(r, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where?: Where } = {}) => rows().filter((r) => matches(r, where))),
      update: vi.fn(async ({ where, data }: { where: Where; data: Row }) => {
        const row = rows().find((r) => matches(r, where));
        if (!row) return null;
        Object.assign(row, data);
        return row;
      }),
    };
  };

  const db = { query: vi.fn(query) };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  vi.stubGlobal('strapi', { db, log, requestContext: { get: () => undefined } });
  return { tables, db, log };
}

export const restoreGlobals = () => vi.unstubAllGlobals();
