import { describe, it, expect, afterEach } from 'vitest';
import { installFakeStrapi, restoreGlobals } from '../helpers/fake-strapi';
import { releaseDependentExecutions } from '../../src/api/task-execution/services/dependency-release';

const EXECUTION = 'api::task-execution.task-execution';

const exec = (
  id: number,
  sourceId: string,
  status: string,
  dependsOn: string[] = [],
  assignmentId = 1,
) => ({
  id,
  task_source_document_id: sourceId,
  execution_status: status,
  task_snapshot: { dependsOn },
  track_assignment: { id: assignmentId },
});

afterEach(restoreGlobals);

describe('releaseDependentExecutions — desbloqueio de tarefas dependentes', () => {
  it('libera uma tarefa locked quando sua única dependência está concluída', async () => {
    const { tables } = installFakeStrapi({
      [EXECUTION]: [exec(1, 'A', 'completed'), exec(2, 'B', 'locked', ['A'])],
    });
    await releaseDependentExecutions(1);
    expect(tables[EXECUTION][1].execution_status).toBe('available');
    expect(tables[EXECUTION][1].released_at).toEqual(expect.any(String));
  });

  it('não libera enquanto a dependência não estiver completed (submitted ainda bloqueia)', async () => {
    const { tables } = installFakeStrapi({
      [EXECUTION]: [exec(1, 'A', 'submitted'), exec(2, 'B', 'locked', ['A'])],
    });
    await releaseDependentExecutions(1);
    expect(tables[EXECUTION][1].execution_status).toBe('locked');
  });

  it('com várias dependências, só libera quando TODAS estão concluídas', async () => {
    const { tables } = installFakeStrapi({
      [EXECUTION]: [
        exec(1, 'A', 'completed'),
        exec(2, 'B', 'in_progress'),
        exec(3, 'C', 'locked', ['A', 'B']),
      ],
    });
    await releaseDependentExecutions(1);
    expect(tables[EXECUTION][2].execution_status).toBe('locked');

    tables[EXECUTION][1].execution_status = 'completed';
    await releaseDependentExecutions(1);
    expect(tables[EXECUTION][2].execution_status).toBe('available');
  });

  it('tarefa locked sem dependências declaradas nunca é liberada por esta regra', async () => {
    const { tables } = installFakeStrapi({ [EXECUTION]: [exec(1, 'A', 'locked', [])] });
    await releaseDependentExecutions(1);
    expect(tables[EXECUTION][0].execution_status).toBe('locked');
  });

  it('dependência que não existe entre as execuções mantém a tarefa bloqueada', async () => {
    const { tables } = installFakeStrapi({ [EXECUTION]: [exec(1, 'B', 'locked', ['inexistente'])] });
    await releaseDependentExecutions(1);
    expect(tables[EXECUTION][0].execution_status).toBe('locked');
  });

  it('ignora execuções que não estão locked (não regride available/in_progress)', async () => {
    const { tables } = installFakeStrapi({
      [EXECUTION]: [exec(1, 'A', 'completed'), exec(2, 'B', 'in_progress', ['A'])],
    });
    await releaseDependentExecutions(1);
    expect(tables[EXECUTION][1].execution_status).toBe('in_progress');
    expect(tables[EXECUTION][1].released_at).toBeUndefined();
  });

  it('ignora execução locked sem task_snapshot', async () => {
    const { tables } = installFakeStrapi({
      [EXECUTION]: [{ id: 1, task_source_document_id: 'A', execution_status: 'locked', task_snapshot: null, track_assignment: { id: 1 } }],
    });
    await releaseDependentExecutions(1);
    expect(tables[EXECUTION][0].execution_status).toBe('locked');
  });

  it('não mistura execuções de outra atribuição', async () => {
    const { tables } = installFakeStrapi({
      [EXECUTION]: [
        exec(1, 'A', 'completed', [], 2), // A concluída, mas na atribuição 2
        exec(2, 'B', 'locked', ['A'], 1),
      ],
    });
    await releaseDependentExecutions(1);
    expect(tables[EXECUTION][1].execution_status).toBe('locked');
  });
});
