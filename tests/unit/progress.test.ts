import { describe, it, expect, afterEach, vi } from 'vitest';
import { installFakeStrapi, restoreGlobals } from '../helpers/fake-strapi';
import { syncTrackAssignmentProgress } from '../../src/api/task-execution/services/progress';

const ASSIGNMENT = 'api::track-assignment.track-assignment';
const EXECUTION = 'api::task-execution.task-execution';

const exec = (id: number, execution_status: string | null, assignmentId = 1) => ({
  id,
  execution_status,
  track_assignment: { id: assignmentId },
});

const setup = (statuses: Array<string | null>, assignment: Record<string, unknown> = {}) =>
  installFakeStrapi({
    [ASSIGNMENT]: [{ id: 1, status: 'not_started', started_at: null, ...assignment }],
    [EXECUTION]: statuses.map((status, index) => exec(index + 1, status)),
  });

afterEach(() => {
  restoreGlobals();
  vi.useRealTimers();
});

describe('syncTrackAssignmentProgress — cálculo de progresso da atribuição', () => {
  it('sem execuções: 0% e not_started (evita divisão por zero)', async () => {
    const { tables } = setup([]);
    await syncTrackAssignmentProgress(1);
    expect(tables[ASSIGNMENT][0]).toMatchObject({
      progress_percentage: 0,
      status: 'not_started',
      completed_at: null,
    });
  });

  it('só locked/available: not_started, sem started_at', async () => {
    const { tables } = setup(['available', 'locked']);
    await syncTrackAssignmentProgress(1);
    expect(tables[ASSIGNMENT][0]).toMatchObject({
      progress_percentage: 0,
      status: 'not_started',
      started_at: null,
    });
  });

  it('qualquer execução fora de locked/available marca in_progress e grava started_at', async () => {
    const { tables } = setup(['submitted', 'locked']);
    await syncTrackAssignmentProgress(1);
    expect(tables[ASSIGNMENT][0].status).toBe('in_progress');
    expect(tables[ASSIGNMENT][0].started_at).toEqual(expect.any(String));
  });

  it('preserva started_at já existente', async () => {
    const { tables } = setup(['completed', 'available'], { started_at: '2026-01-01T00:00:00.000Z' });
    await syncTrackAssignmentProgress(1);
    expect(tables[ASSIGNMENT][0].started_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('mantém started_at existente mesmo se o progresso voltar a not_started', async () => {
    const { tables } = setup(['available'], { started_at: '2026-01-01T00:00:00.000Z' });
    await syncTrackAssignmentProgress(1);
    expect(tables[ASSIGNMENT][0].started_at).toBe('2026-01-01T00:00:00.000Z');
    expect(tables[ASSIGNMENT][0].status).toBe('not_started');
  });

  it('arredonda o percentual para 2 casas (1 de 3 → 33.33)', async () => {
    const { tables } = setup(['completed', 'available', 'locked']);
    await syncTrackAssignmentProgress(1);
    expect(tables[ASSIGNMENT][0].progress_percentage).toBe(33.33);
  });

  it('submitted (aguardando aprovação) NÃO conta como concluída', async () => {
    const { tables } = setup(['completed', 'submitted']);
    await syncTrackAssignmentProgress(1);
    expect(tables[ASSIGNMENT][0].progress_percentage).toBe(50);
    expect(tables[ASSIGNMENT][0].status).toBe('in_progress');
  });

  it('todas concluídas: 100%, completed e completed_at preenchido', async () => {
    const { tables } = setup(['completed', 'completed']);
    await syncTrackAssignmentProgress(1);
    expect(tables[ASSIGNMENT][0]).toMatchObject({ progress_percentage: 100, status: 'completed' });
    expect(tables[ASSIGNMENT][0].completed_at).toEqual(expect.any(String));
  });

  it('só considera execuções da atribuição informada', async () => {
    const { tables } = installFakeStrapi({
      [ASSIGNMENT]: [{ id: 1 }],
      [EXECUTION]: [exec(1, 'completed', 1), exec(2, 'locked', 2), exec(3, 'locked', 2)],
    });
    await syncTrackAssignmentProgress(1);
    expect(tables[ASSIGNMENT][0].progress_percentage).toBe(100);
  });

  it('atribuição inexistente lança TRACK_ASSIGNMENT_PROGRESS_NOT_FOUND', async () => {
    installFakeStrapi({ [ASSIGNMENT]: [], [EXECUTION]: [] });
    await expect(syncTrackAssignmentProgress(99)).rejects.toMatchObject({
      details: { code: 'TRACK_ASSIGNMENT_PROGRESS_NOT_FOUND', trackAssignmentId: 99 },
    });
  });
});
