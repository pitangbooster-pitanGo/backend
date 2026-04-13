import { errors } from '@strapi/utils';

const { PolicyError, UnauthorizedError } = errors;

type PolicyContext = {
  state: {
    user?: {
      id: number;
    };
  };
};

type PolicyConfig = {
  roles?: string[];
};

export default async (policyContext: PolicyContext, config: PolicyConfig = {}) => {
  const authUser = policyContext.state.user;

  if (!authUser) {
    throw new UnauthorizedError('Autenticação obrigatória');
  }

  const allowedRoles = config.roles ?? [];

  if (allowedRoles.length === 0) {
    return true;
  }

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: authUser.id },
    populate: ['role'],
  });

  if (!user?.role) {
    throw new PolicyError('Perfil não encontrado');
  }

  const matchesRole =
    allowedRoles.includes(user.role.type) || allowedRoles.includes(user.role.name);

  if (!matchesRole) {
    throw new PolicyError('Usuário sem permissão para acessar este recurso');
  }

  return true;
};
