import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/admin/**',
        'src/**/content-types/**/schema.json',
        'src/index.ts',
        'src/bootstrap/**',
        'types/**',
        'tests/**',
      ],
    },
    projects: [
      {
        // Regras de negócio isoladas: `strapi.db` é substituído por um banco em
        // memória (tests/helpers/fake-strapi.ts). Não sobe Strapi nem precisa
        // de banco — roda em segundos e mede cobertura real (o código passa
        // pelo pipeline de transform do Vitest).
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          // Roda antes da integração (grupos distintos, pois os projetos têm
          // paralelismo diferente).
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup/vitest.setup.ts'],
          testTimeout: 30_000,
          // O primeiro boot cria TODAS as tabelas na schema pitang_test do zero
          // (pode passar de 1 min numa conexão remota); boots seguintes reusam a
          // schema e são bem mais rápidos.
          hookTimeout: 300_000,
          // Todos os testes de integração compartilham UMA instância Strapi (boot
          // único, ~20-30s) e UM schema de banco (pitang_test) — precisam do mesmo
          // processo/module registry (isolate:false) e rodar em sequência.
          fileParallelism: false,
          isolate: false,
          pool: 'forks',
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
