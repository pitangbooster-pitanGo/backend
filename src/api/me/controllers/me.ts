export default {
  async meWithRole(ctx) {
    const authUser = ctx.state.user;

    if (!authUser) {
      return ctx.unauthorized('Autenticação obrigatória');
    }

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: authUser.id },
      populate: ['role'],
    });

    if (!user) {
      return ctx.notFound('Usuário não encontrado');
    }

    ctx.body = {
      id: user.id,
      documentId: user.documentId,
      username: user.username,
      email: user.email,
      provider: user.provider,
      confirmed: user.confirmed,
      blocked: user.blocked,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      publishedAt: user.publishedAt,
      role: user.role
        ? {
            id: user.role.id,
            name: user.role.name,
            description: user.role.description,
            type: user.role.type,
          }
        : null,
    };
  },
};
