import { describe, it, expect, afterEach } from 'vitest';
import { installFakeStrapi, restoreGlobals } from '../helpers/fake-strapi';
import { getTasksForTrack } from '../../src/api/task-execution/services/task-selection';

const TASK = 'api::task.task';

afterEach(restoreGlobals);

describe('getTasksForTrack — seleção e ordenação das tarefas da trilha', () => {
  it('retorna as tarefas ordenadas por order_index', async () => {
    installFakeStrapi({
      [TASK]: [
        { id: 3, documentId: 'c', order_index: 3, track: { id: 1 } },
        { id: 1, documentId: 'a', order_index: 1, track: { id: 1 } },
        { id: 2, documentId: 'b', order_index: 2, track: { id: 1 } },
      ],
    });
    const tasks = await getTasksForTrack(1);
    expect(tasks.map((t) => t.order_index)).toEqual([1, 2, 3]);
  });

  it('exclui tarefas desativadas (is_active=false) e mantém as sem flag', async () => {
    installFakeStrapi({
      [TASK]: [
        { id: 1, documentId: 'a', order_index: 1, is_active: false, track: { id: 1 } },
        { id: 2, documentId: 'b', order_index: 2, is_active: true, track: { id: 1 } },
        { id: 3, documentId: 'c', order_index: 3, track: { id: 1 } },
      ],
    });
    const tasks = await getTasksForTrack(1);
    expect(tasks.map((t) => t.documentId)).toEqual(['b', 'c']);
  });

  it('só traz tarefas da trilha pedida', async () => {
    installFakeStrapi({
      [TASK]: [
        { id: 1, documentId: 'a', order_index: 1, track: { id: 1 } },
        { id: 2, documentId: 'b', order_index: 1, track: { id: 2 } },
      ],
    });
    const tasks = await getTasksForTrack(2);
    expect(tasks.map((t) => t.documentId)).toEqual(['b']);
  });

  it('deduplica por documentId preferindo a versão publicada', async () => {
    installFakeStrapi({
      [TASK]: [
        { id: 1, documentId: 'a', order_index: 1, publishedAt: null, title: 'rascunho', track: { id: 1 } },
        { id: 2, documentId: 'a', order_index: 1, publishedAt: '2026-01-01', title: 'publicada', track: { id: 1 } },
      ],
    });
    const tasks = await getTasksForTrack(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'publicada' });
  });

  it('usa o id quando a tarefa não tem documentId', async () => {
    installFakeStrapi({
      [TASK]: [
        { id: 1, order_index: 1, track: { id: 1 } },
        { id: 2, order_index: 2, track: { id: 1 } },
      ],
    });
    expect(await getTasksForTrack(1)).toHaveLength(2);
  });
});
