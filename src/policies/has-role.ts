import { errors } from '@strapi/utils';

const { ApplicationError, PolicyError, UnauthorizedError } = errors;

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
    throw new UnauthorizedError('Autenticação obrigatória', {
      code: 'AUTH_REQUIRED',
      policy: 'has-role',
    });
  }

  const allowedRoles = config.roles ?? [];

  if (allowedRoles.length === 0) {
    return true;
  }

  let user;

  try {
    user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: authUser.id },
      populate: ['role'],
    });
  } catch (error) {
    strapi.log.error('[Policy.has-role] Falha ao consultar usuario', {
      userId: authUser.id,
      allowedRoles,
      error,
    });
    throw new ApplicationError('Falha ao validar permissoes do usuario', {
      code: 'POLICY_ROLE_LOOKUP_FAILED',
      policy: 'has-role',
    });
  }

  if (!user?.role) {
    throw new PolicyError('Perfil não encontrado', {
      code: 'USER_ROLE_NOT_FOUND',
      policy: 'has-role',
      userId: authUser.id,
    });
  }

  const matchesRole =
    allowedRoles.includes(user.role.type) || allowedRoles.includes(user.role.name);

  if (!matchesRole) {
    throw new PolicyError('Usuário sem permissão para acessar este recurso', {
      code: 'USER_ROLE_FORBIDDEN',
      policy: 'has-role',
      userId: authUser.id,
      allowedRoles,
      currentRole: user.role.type ?? user.role.name,
    });
  }

  return true;
};
