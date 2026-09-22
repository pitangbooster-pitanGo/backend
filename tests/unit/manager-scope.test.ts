import { describe, it, expect } from 'vitest';
import { assertTrackInScope, buildScopeFilter, type ManagerScope } from '../../src/utils/manager-scope';

const unrestricted: ManagerScope = { unrestricted: true, projectIds: [], trackIds: [] };
const scoped: ManagerScope = { unrestricted: false, projectIds: [10, 11], trackIds: [1, 2, 3] };
const empty: ManagerScope = { unrestricted: false, projectIds: [], trackIds: [] };

describe('buildScopeFilter — filtro mesclado em ctx.query.filters', () => {
  it('sem restrição (admin/hr): nenhum filtro é aplicado', () => {
    for (const kind of ['project', 'track', 'track-assignment', 'task-execution'] as const) {
      expect(buildScopeFilter(unrestricted, kind)).toBeNull();
    }
  });

  it('project: filtra pelo próprio id', () => {
    expect(buildScopeFilter(scoped, 'project')).toEqual({ id: { $in: [10, 11] } });
  });

  it('track: filtra pelo próprio id', () => {
    expect(buildScopeFilter(scoped, 'track')).toEqual({ id: { $in: [1, 2, 3] } });
  });

  it('track-assignment: filtra pela trilha relacionada', () => {
    expect(buildScopeFilter(scoped, 'track-assignment')).toEqual({ track: { id: { $in: [1, 2, 3] } } });
  });

  it('task-execution: filtra pela trilha da atribuição relacionada', () => {
    expect(buildScopeFilter(scoped, 'task-execution')).toEqual({
      track_assignment: { track: { id: { $in: [1, 2, 3] } } },
    });
  });

  it('escopo vazio gera $in: [] — nenhum resultado, não "sem filtro"', () => {
    expect(buildScopeFilter(empty, 'track')).toEqual({ id: { $in: [] } });
  });
});

describe('assertTrackInScope', () => {
  it('não lança para quem não tem restrição', () => {
    expect(() => assertTrackInScope(unrestricted, 999)).not.toThrow();
  });

  it('não lança quando a trilha está no escopo', () => {
    expect(() => assertTrackInScope(scoped, 2)).not.toThrow();
  });

  it('lança TRACK_OUTSIDE_MANAGED_SCOPE quando a trilha não está no escopo', () => {
    try {
      assertTrackInScope(scoped, 999);
      expect.unreachable();
    } catch (error: any) {
      expect(error.details.code).toBe('TRACK_OUTSIDE_MANAGED_SCOPE');
    }
  });

  it('escopo vazio sempre lança (não confunde "vazio" com "sem restrição")', () => {
    expect(() => assertTrackInScope(empty, 1)).toThrow();
  });
});
