import { factories } from '@strapi/strapi';

type TrackRequestBody = {
  data?: Record<string, unknown>;
};

export default factories.createCoreController('api::track.track', () => ({
  async create(ctx) {
    const authUser = ctx.state.user;

    if (!authUser) {
      return ctx.unauthorized('Autenticação obrigatória');
    }

    const body = (ctx.request.body ?? {}) as TrackRequestBody;

    ctx.request.body = {
      ...body,
      data: {
        ...(body.data ?? {}),
        created_by_user: authUser.id,
      },
    };

    return super.create(ctx);
  },

  async update(ctx) {
    const body = (ctx.request.body ?? {}) as TrackRequestBody;
    const authUser = ctx.state.user;

    if (!authUser) {
      return ctx.unauthorized('Autenticação obrigatória');
    }

    if (body.data) {
      const { created_by_user: _createdByUser, ...data } = body.data;

      ctx.request.body = {
        ...body,
        data,
      };
    }

    return super.update(ctx);
  },
}));
