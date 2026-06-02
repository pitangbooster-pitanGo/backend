import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';

type UserWithRole = {
  id?: number;
  documentId?: string;
  username?: string;
  email?: string;
  name?: string | null;
  provider?: string | null;
  confirmed?: boolean | null;
  blocked?: boolean | null;
  is_active?: boolean | null;
  createdAt?: string;
  updatedAt?: string;
  role?: {
    id?: number;
    name?: string;
    description?: string | null;
    type?: string;
  } | null;
};

export default {
  async meWithRole(ctx) {
    try {
      const authUser = ctx.state.user;

      if (!authUser) {
        return ctx.unauthorized('Autenticação obrigatória', {
          code: 'AUTH_REQUIRED',
        });
      }

      const userContentType = strapi.contentType('plugin::users-permissions.user');

      await strapi.contentAPI.validate.query(ctx.query, userContentType, {
        auth: ctx.state.auth,
      });
      await strapi.contentAPI.sanitize.query(ctx.query, userContentType, {
        auth: ctx.state.auth,
      });

      const user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: authUser.id },
        populate: ['role'],
      });

      if (!user) {
        return ctx.notFound('Usuário não encontrado', {
          code: 'USER_NOT_FOUND',
          userId: authUser.id,
        });
      }

      const sanitizedUser = (await strapi.contentAPI.sanitize.output(user, userContentType, {
        auth: ctx.state.auth,
      })) as UserWithRole;

      ctx.body = {
        id: sanitizedUser.id,
        documentId: sanitizedUser.documentId,
        username: sanitizedUser.username,
        email: sanitizedUser.email,
        name: sanitizedUser.name,
        provider: sanitizedUser.provider,
        confirmed: sanitizedUser.confirmed,
        blocked: sanitizedUser.blocked,
        is_active: sanitizedUser.is_active,
        createdAt: sanitizedUser.createdAt,
        updatedAt: sanitizedUser.updatedAt,
        role: sanitizedUser.role
          ? {
              id: sanitizedUser.role.id,
              name: sanitizedUser.role.name,
              description: sanitizedUser.role.description,
              type: sanitizedUser.role.type,
            }
          : null,
      };
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('me.meWithRole', error, {
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao buscar usuário autenticado', {
        code: 'ME_LOAD_FAILED',
      });
    }
  },
};
