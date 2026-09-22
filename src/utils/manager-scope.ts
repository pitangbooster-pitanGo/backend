import type { UID } from '@strapi/types';
import { errors } from '@strapi/utils';

const { ForbiddenError } = errors;

/**
 * `projectIds`/`trackIds` sempre existem (vazios quando não fazem sentido) —
 * de propósito, em vez de uma union discriminada por `unrestricted`: este
 * projeto compila com `strict: false` (sem `strictNullChecks`), configuração
 * na qual o TypeScript não faz o narrowing de unions discriminadas por um
 * literal booleano. Um objeto único e plano evita depender disso.
 */
export type ManagerScope = {
  unrestricted: boolean;
  projectIds: number[];
  trackIds: number[];
};

/**
 * Modelo de visibilidade por perfil:
 * - `admin`/`hr`: administração técnica — veem e agem sobre tudo, sem recorte.
 * - `leadership` (gestor/gerente): acesso funcional — só o que foi
 *   DIRECIONADO A ELE: trilhas institucionais (da empresa toda) ou de
 *   projetos onde está entre os `managers`.
 * - `employee` (colaborador): só o que foi DIRECIONADO A ELE — trilhas às
 *   quais tem uma `TrackAssignment`, e os projetos aos quais essas trilhas
 *   pertencem.
 */
const unrestricted = (): ManagerScope => ({ unrestricted: true, projectIds: [], trackIds: [] });
const scoped = (projectIds: number[], trackIds: number[]): ManagerScope => ({
  unrestricted: false,
  projectIds,
  trackIds,
});

const projectIdsFromTracks = async (trackIds: number[]): Promise<number[]> => {
  if (trackIds.length === 0) {
    return [];
  }
  const projects = (await strapi.db.query('api::project.project' as UID.ContentType).findMany({
    where: { tracks: { id: { $in: trackIds } } },
    select: ['id'],
  })) as Array<{ id: number }>;
  return projects.map((project) => project.id);
};

const getLeadershipScope = async (userId: number): Promise<ManagerScope> => {
  const managedProjects = (await strapi.db.query('api::project.project' as UID.ContentType).findMany({
    where: { managers: { id: userId } },
    select: ['id'],
  })) as Array<{ id: number }>;
  const projectIds = managedProjects.map((project) => project.id);

  const visibleTracks = (await strapi.db.query('api::track.track' as UID.ContentType).findMany({
    where: {
      $or: [
        { track_type: 'institutional' },
        ...(projectIds.length > 0 ? [{ projects: { id: { $in: projectIds } } }] : []),
      ],
    },
    select: ['id'],
  })) as Array<{ id: number }>;

  return scoped(projectIds, visibleTracks.map((track) => track.id));
};

const getEmployeeScope = async (userId: number): Promise<ManagerScope> => {
  const assignments = (await strapi.db.query('api::track-assignment.track-assignment' as UID.ContentType).findMany({
    where: { user: userId },
    populate: ['track'],
  })) as Array<{ track?: { id: number } | null }>;

  const trackIds = [...new Set(assignments.map((assignment) => assignment.track?.id).filter(
    (id): id is number => typeof id === 'number'
  ))];

  return scoped(await projectIdsFromTracks(trackIds), trackIds);
};

/**
 * Calcula o escopo de visibilidade de um usuário a partir do seu perfil. Duas
 * ou três queries simples e planas, em vez de filtros profundamente
 * aninhados (mais fácil de auditar e não depende de comportamento de JOIN do
 * Strapi para relações de 2+ níveis).
 */
export const getScopeForRole = async (userId: number, roleType: string | undefined | null): Promise<ManagerScope> => {
  switch (roleType) {
    case 'admin':
    case 'hr':
      return unrestricted();
    case 'leadership':
      return getLeadershipScope(userId);
    case 'employee':
      return getEmployeeScope(userId);
    default:
      // Perfil desconhecido: mais seguro não vazar dado do que travar a rota.
      return scoped([], []);
  }
};

/**
 * Filtro a mesclar em `ctx.query.filters` para listagens/leituras de um único
 * registro (o Strapi aplica `filters` também no `findOne`, combinando com o
 * id pedido — fora do escopo vira 404, nunca 403, sem confirmar existência).
 */
export const buildScopeFilter = (
  scope: ManagerScope,
  kind: 'project' | 'track' | 'track-assignment' | 'task-execution'
): Record<string, unknown> | null => {
  if (scope.unrestricted) {
    return null;
  }

  switch (kind) {
    case 'project':
      return { id: { $in: scope.projectIds } };
    case 'track':
      return { id: { $in: scope.trackIds } };
    case 'track-assignment':
      return { track: { id: { $in: scope.trackIds } } };
    case 'task-execution':
      return { track_assignment: { track: { id: { $in: scope.trackIds } } } };
    default:
      return null;
  }
};

/** Resolve o perfil do usuário e calcula o escopo numa chamada só (controllers de `find`/`findOne`). */
export const getScopeForUser = async (userId: number): Promise<ManagerScope> => {
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    populate: ['role'],
  });
  return getScopeForRole(userId, user?.role?.type as string | undefined);
};

/**
 * Mescla o filtro de escopo num `sanitizedQuery` já validado (`this.sanitizeQuery(ctx)`),
 * pronto para ir direto ao `strapi.service(uid).find/findOne(...)`.
 *
 * Importante: isto NUNCA deve ser feito reatribuindo `ctx.query` numa policy —
 * o setter de `ctx.query` do Koa serializa para querystring com
 * `querystring.stringify`, que não suporta objetos aninhados com arrays
 * (`{ id: { $in: [...] } }` vira lixo). Por isso o merge acontece aqui, como
 * um objeto JS comum, direto no controller.
 */
export const mergeScopeIntoQuery = <Q extends { filters?: unknown }>(
  query: Q,
  scope: ManagerScope,
  kind: 'project' | 'track' | 'track-assignment' | 'task-execution'
): Q => {
  const scopeFilter = buildScopeFilter(scope, kind);
  if (!scopeFilter) {
    return query;
  }
  return {
    ...query,
    filters: query.filters ? { $and: [query.filters, scopeFilter] } : scopeFilter,
  };
};

/** Garante que uma trilha específica está no escopo antes de uma AÇÃO DE ESCRITA (atribuir, aprovar, rejeitar). */
export const assertTrackInScope = (scope: ManagerScope, trackId: number) => {
  if (scope.unrestricted) {
    return;
  }
  if (!scope.trackIds.includes(trackId)) {
    throw new ForbiddenError('Esta trilha não pertence a um projeto sob sua gestão', {
      code: 'TRACK_OUTSIDE_MANAGED_SCOPE',
    });
  }
};

/**
 * Atalho para as ações de escrita que recebem um `trackId` já resolvido
 * (atribuir uma trilha, aprovar/rejeitar uma execução): busca o perfil do
 * usuário e valida numa chamada só.
 */
export const assertUserCanActOnTrack = async (userId: number, trackId: number) => {
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    populate: ['role'],
  });
  const scope = await getScopeForRole(userId, user?.role?.type as string | undefined);
  assertTrackInScope(scope, trackId);
};
