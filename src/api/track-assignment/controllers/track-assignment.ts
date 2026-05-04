import { factories } from '@strapi/strapi';

type RelationReference = number | string | { id?: number | string; documentId?: string } | null;

type RequestBody = {
  data?: Record<string, unknown>;
};

type QueryWhere = {
  id?: number;
  documentId?: string;
};

type CreatedResponse = {
  data?: {
    id?: number;
    documentId?: string;
  };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toWhere = (value: RelationReference): QueryWhere | null => {
  if (typeof value === 'number') {
    return { id: value };
  }

  if (typeof value === 'string') {
    return /^\d+$/.test(value) ? { id: Number(value) } : { documentId: value };
  }

  if (isPlainObject(value)) {
    if (typeof value.id === 'number') {
      return { id: value.id };
    }

    if (typeof value.id === 'string' && /^\d+$/.test(value.id)) {
      return { id: Number(value.id) };
    }

    if (typeof value.documentId === 'string' && value.documentId.length > 0) {
      return { documentId: value.documentId };
    }
  }

  return null;
};

const findEntity = async <T>(
  uid: string,
  reference: RelationReference,
  populate?: string[]
): Promise<T | null> => {
  const where = toWhere(reference);

  if (!where) {
    return null;
  }

  return (await strapi.db.query(uid).findOne({
    where,
    populate,
  })) as T | null;
};

export default factories.createCoreController('api::track-assignment.track-assignment', () => ({
  async create(ctx) {
    const authUser = ctx.state.user;

    if (!authUser) {
      return ctx.unauthorized('Autenticacao obrigatoria');
    }

    const body = (ctx.request.body ?? {}) as RequestBody;
    const data = body.data ?? {};

    const track = await findEntity<{ id: number; version?: number | null }>(
      'api::track.track',
      data.track as RelationReference
    );

    if (!track) {
      return ctx.badRequest('Trilha informada nao foi encontrada');
    }

    const assignedUser = await findEntity<{ id: number }>(
      'plugin::users-permissions.user',
      data.user as RelationReference
    );

    if (!assignedUser) {
      return ctx.badRequest('Usuario informado nao foi encontrado');
    }

    ctx.request.body = {
      ...body,
      data: {
        ...data,
        track: track.id,
        user: assignedUser.id,
        assigned_by: authUser.id,
        status: 'not_started',
        progress_percentage: 0,
        started_at: null,
        completed_at: null,
        track_version: track.version ?? 1,
      },
    };

    const response = (await super.create(ctx)) as CreatedResponse;
    const createdAssignment = await strapi
      .db.query('api::track-assignment.track-assignment')
      .findOne({
        where: response?.data?.id
          ? { id: response.data.id }
          : response?.data?.documentId
            ? { documentId: response.data.documentId }
            : {},
        populate: ['track'],
      });

    if (createdAssignment) {
      await strapi
        .service('api::task-execution.task-execution')
        .createExecutionsForAssignment(createdAssignment);
      await strapi
        .service('api::task-execution.task-execution')
        .syncTrackAssignmentProgress(createdAssignment.id);
    }

    return response;
  },

  async myAssignments(ctx) {
    const authUser = ctx.state.user;

    if (!authUser) {
      return ctx.unauthorized('Autenticacao obrigatoria');
    }

    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const filters = isPlainObject(sanitizedQuery.filters) ? sanitizedQuery.filters : {};
    const { results, pagination } = await strapi
      .service('api::track-assignment.track-assignment')
      .find({
        ...sanitizedQuery,
        filters: {
          ...filters,
          user: {
            id: {
              $eq: authUser.id,
            },
          },
        },
        sort: sanitizedQuery.sort ?? ['createdAt:desc'],
      });
    const sanitizedResults = await this.sanitizeOutput(results, ctx);

    return this.transformResponse(sanitizedResults, { pagination });
  },
}));
