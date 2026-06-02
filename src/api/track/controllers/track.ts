import { factories } from '@strapi/strapi';

import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';

type TrackRequestBody = {
  data?: Record<string, unknown>;
};

export default factories.createCoreController('api::track.track', () => ({
  async create(ctx) {
    try {
      const authUser = ctx.state.user;

      if (!authUser) {
        return ctx.unauthorized('Autenticação obrigatória', {
          code: 'AUTH_REQUIRED',
        });
      }

      const body = (ctx.request.body ?? {}) as TrackRequestBody;
      const data = body.data ?? {};

      await this.validateInput(data, ctx);
      const sanitizedData = (await this.sanitizeInput(data, ctx)) as Record<string, unknown>;

      ctx.request.body = {
        ...body,
        data: {
          ...sanitizedData,
          created_by_user: authUser.id,
        },
      };

      return super.create(ctx);
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('track.create', error, {
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao criar trilha', {
        code: 'TRACK_CREATE_FAILED',
      });
    }
  },

  async update(ctx) {
    try {
      const body = (ctx.request.body ?? {}) as TrackRequestBody;
      const authUser = ctx.state.user;

      if (!authUser) {
        return ctx.unauthorized('Autenticação obrigatória', {
          code: 'AUTH_REQUIRED',
        });
      }

      if (body.data) {
        const { created_by_user: _createdByUser, ...data } = body.data;
        await this.validateInput(data, ctx);
        const sanitizedData = (await this.sanitizeInput(data, ctx)) as Record<string, unknown>;

        ctx.request.body = {
          ...body,
          data: sanitizedData,
        };
      }

      return super.update(ctx);
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('track.update', error, {
        trackId: ctx.params.id,
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao atualizar trilha', {
        code: 'TRACK_UPDATE_FAILED',
        trackId: ctx.params.id,
      });
    }
  },
}));
