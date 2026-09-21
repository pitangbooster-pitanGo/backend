import { factories } from '@strapi/strapi';

import { findEntity, isPlainObject } from '../../../utils/relation-reference';
import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';
import { logEvent } from '../../../utils/logger';
import { recordAuditLog } from '../../../utils/audit-log';

type RequestBody = {
  data?: Record<string, unknown>;
};

type TrackAssignmentAuditSnapshot = {
  id: number;
  documentId?: string | null;
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
      await recordAuditLog({
        entityType: 'track-assignment',
        entityId: (assignment as TrackAssignmentAuditSnapshot)?.documentId ?? null,
        action: 'create',
        actorId: authUser.id,
        after: assignment,
      });

      logEvent('track-assignment.created', {
        assignmentId: (assignment as TrackAssignmentAuditSnapshot)?.documentId ?? null,
        assignedByUserId: authUser.id,
      });

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

  async update(ctx) {
    try {
      const authUser = ctx.state.user;

      if (!authUser) {
        return ctx.unauthorized('Autenticacao obrigatoria', {
          code: 'AUTH_REQUIRED',
        });
      }

      const before = await findEntity<TrackAssignmentAuditSnapshot>(
        'api::track-assignment.track-assignment',
        ctx.params.id as string
      );

      if (!before) {
        return ctx.notFound('Atribuicao de trilha nao encontrada', {
          code: 'TRACK_ASSIGNMENT_NOT_FOUND',
          assignmentId: ctx.params.id,
        });
      }

      return strapi.db.transaction(async () => {
        const response = await super.update(ctx);
        const after = await findEntity<TrackAssignmentAuditSnapshot>(
          'api::track-assignment.track-assignment',
          ctx.params.id as string
        );

        await recordAuditLog({
          entityType: 'track-assignment',
          entityId: before.documentId ?? after?.documentId ?? (ctx.params.id as string),
          action: 'update',
          actorId: authUser.id,
          before,
          after,
        });

        logEvent('track-assignment.updated', {
          assignmentId: before.documentId ?? (ctx.params.id as string),
          userId: authUser.id,
        });

        return response;
      });
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('track-assignment.update', error, {
        assignmentId: ctx.params.id,
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao atualizar atribuicao de trilha', {
        code: 'TRACK_ASSIGNMENT_UPDATE_FAILED',
        assignmentId: ctx.params.id,
      });
    }
  },

  async delete(ctx) {
    try {
      const authUser = ctx.state.user;

      if (!authUser) {
        return ctx.unauthorized('Autenticacao obrigatoria', {
          code: 'AUTH_REQUIRED',
        });
      }

      const currentAssignment = await findEntity<TrackAssignmentAuditSnapshot>(
        'api::track-assignment.track-assignment',
        ctx.params.id as string
      );

      if (!currentAssignment) {
        return ctx.notFound('Atribuicao de trilha nao encontrada', {
          code: 'TRACK_ASSIGNMENT_NOT_FOUND',
          assignmentId: ctx.params.id,
        });
      }

      return strapi.db.transaction(async () => {
        const response = await super.delete(ctx);

        await recordAuditLog({
          entityType: 'track-assignment',
          entityId: currentAssignment.documentId ?? (ctx.params.id as string),
          action: 'delete',
          actorId: authUser.id,
          before: currentAssignment,
        });

        logEvent('track-assignment.deleted', {
          assignmentId: currentAssignment.documentId ?? (ctx.params.id as string),
          userId: authUser.id,
        });

        return response;
      });
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('track-assignment.delete', error, {
        assignmentId: ctx.params.id,
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao excluir atribuicao de trilha', {
        code: 'TRACK_ASSIGNMENT_DELETE_FAILED',
        assignmentId: ctx.params.id,
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
