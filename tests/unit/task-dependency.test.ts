import { describe, it, expect, afterEach } from 'vitest';
import { installFakeStrapi, restoreGlobals } from '../helpers/fake-strapi';
import { validateTaskDependencies } from '../../src/api/task/services/task-dependency';

const TASK = 'api::task.task';
const TRACK = 'api::track.track';

const seed = () =>
  installFakeStrapi({
    [TRACK]: [{ id: 1 }, { id: 2 }],
    [TASK]: [
      { id: 10, order_index: 1, track: { id: 1 } },
      { id: 11, order_index: 2, track: { id: 1 } },
      { id: 20, order_index: 1, track: { id: 2 } },
    ],
  });

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error) => error.details?.code,
  );

afterEach(restoreGlobals);

describe('validateTaskDependencies — regras de dependência entre tarefas', () => {
  it('sem depends_on: nada a validar', async () => {
    seed();
    expect(await validateTaskDependencies({ data: { order_index: 3 } })).toBeNull();
    expect(await validateTaskDependencies({})).toBeNull();
  });

  it('dependência anterior da mesma trilha é aceita', async () => {
    seed();
    const result = await validateTaskDependencies({
      data: { track: 1, order_index: 3, depends_on: [10, 11] },
    });
    expect(result).toBeNull();
  });

  it('aceita a forma { set: [...] } / { connect: [...] } e referências por documentId/objeto', async () => {
    installFakeStrapi({
      [TRACK]: [{ id: 1 }],
      [TASK]: [{ id: 10, documentId: 'doc-10', order_index: 1, track: { id: 1 } }],
    });
    expect(
      await validateTaskDependencies({
        data: { track: 1, order_index: 2, depends_on: { set: [{ documentId: 'doc-10' }] } },
      }),
    ).toBeNull();
    expect(
      await validateTaskDependencies({
        data: { track: 1, order_index: 2, depends_on: { connect: ['doc-10'] } },
      }),
    ).toBeNull();
  });

  it('sem trilha válida: TASK_TRACK_REQUIRED_FOR_DEPENDENCIES', async () => {
    seed();
    expect(
      await codeOf(validateTaskDependencies({ data: { order_index: 3, depends_on: [10] } })),
    ).toBe('TASK_TRACK_REQUIRED_FOR_DEPENDENCIES');
    expect(
      await codeOf(validateTaskDependencies({ data: { track: 999, order_index: 3, depends_on: [10] } })),
    ).toBe('TASK_TRACK_REQUIRED_FOR_DEPENDENCIES');
  });

  it('sem ordem informada: TASK_ORDER_REQUIRED_FOR_DEPENDENCIES', async () => {
    seed();
    expect(await codeOf(validateTaskDependencies({ data: { track: 1, depends_on: [10] } }))).toBe(
      'TASK_ORDER_REQUIRED_FOR_DEPENDENCIES',
    );
  });

  it('dependência inexistente: TASK_DEPENDENCY_NOT_FOUND', async () => {
    seed();
    expect(
      await codeOf(validateTaskDependencies({ data: { track: 1, order_index: 3, depends_on: [999] } })),
    ).toBe('TASK_DEPENDENCY_NOT_FOUND');
  });

  it('tarefa dependendo dela mesma: TASK_DEPENDS_ON_ITSELF', async () => {
    seed();
    const current = { id: 11, order_index: 2, track: { id: 1 } };
    expect(await codeOf(validateTaskDependencies({ data: { depends_on: [11] } }, current))).toBe(
      'TASK_DEPENDS_ON_ITSELF',
    );
  });

  it('dependência de outra trilha: TASK_DEPENDENCY_TRACK_MISMATCH', async () => {
    seed();
    expect(
      await codeOf(validateTaskDependencies({ data: { track: 1, order_index: 3, depends_on: [20] } })),
    ).toBe('TASK_DEPENDENCY_TRACK_MISMATCH');
  });

  it('dependência com ordem igual ou posterior: TASK_DEPENDENCY_ORDER_INVALID', async () => {
    seed();
    // ordem igual (dependência 11 tem order 2, a tarefa também)
    expect(
      await codeOf(validateTaskDependencies({ data: { track: 1, order_index: 2, depends_on: [11] } })),
    ).toBe('TASK_DEPENDENCY_ORDER_INVALID');
    // ordem anterior à da dependência
    expect(
      await codeOf(validateTaskDependencies({ data: { track: 1, order_index: 1, depends_on: [11] } })),
    ).toBe('TASK_DEPENDENCY_ORDER_INVALID');
  });

  it('em atualização, herda trilha e ordem da tarefa atual quando o payload não os traz', async () => {
    seed();
    const current = { id: 11, order_index: 2, track: { id: 1 } };
    expect(await validateTaskDependencies({ data: { depends_on: [10] } }, current)).toBeNull();
  });
});
