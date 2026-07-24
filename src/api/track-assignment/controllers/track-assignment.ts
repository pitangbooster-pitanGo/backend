import { factories } from '@strapi/strapi';

import { isPlainObject } from '../../../utils/relation-reference';
import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';

type RequestBody = {
  data?: Record<string, unknown>;
};

export default factories.createCoreController('api::track-assignment.track-assignment', () => ({
  async create(ctx) {
    try {
      const authUser = ctx.state.user;

      if (!authUser) {
        return ctx.unauthorized('Autenticacao obrigatoria', {
          code: 'AUTH_REQUIRED',
        });
      }

      const body = (ctx.request.body ?? {}) as RequestBody;
      const data = body.data ?? {};
      await this.validateQuery(ctx);
      const sanitizedQuery = (await this.sanitizeQuery(ctx)) as Record<string, unknown>;
      await this.validateInput(data, ctx);
      const sanitizedData = (await this.sanitizeInput(data, ctx)) as Record<string, unknown>;

      const assignment = await strapi.db.transaction(() =>
        strapi
          .service('api::track-assignment.track-assignment')
          .assignTrackToUser({
            data: sanitizedData,
            assignedByUserId: authUser.id,
            query: sanitizedQuery,
          })
      );
      const sanitizedAssignment = await this.sanitizeOutput(assignment, ctx);

      ctx.status = 201;
      return this.transformResponse(sanitizedAssignment);
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('track-assignment.create', error, {
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao criar atribuicao de trilha', {
        code: 'TRACK_ASSIGNMENT_CREATE_FAILED',
      });
    }
  },

  async myAssignments(ctx) {
    try {
      const authUser = ctx.state.user;

      if (!authUser) {
        return ctx.unauthorized('Autenticacao obrigatoria', {
          code: 'AUTH_REQUIRED',
        });
      }

      await this.validateQuery(ctx);
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
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('track-assignment.myAssignments', error, {
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao listar atribuicoes de trilha', {
        code: 'TRACK_ASSIGNMENTS_LIST_FAILED',
      });
    }
  },
}));
