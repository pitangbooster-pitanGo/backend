import { errors } from '@strapi/utils';

const { ApplicationError, PolicyError, UnauthorizedError } = errors;

type PolicyContext = {
  state: {
    user?: {
      id: number;
    };
  };
};

export default async (policyContext: PolicyContext) => {
  const authUser = policyContext.state.user;

  if (!authUser) {
    throw new UnauthorizedError('Autenticação obrigatória', {
      code: 'AUTH_REQUIRED',
      policy: 'is-active-user',
    });
  }

  let user: {
    blocked?: boolean;
    is_active?: boolean;
  } | null;

  try {
    user = (await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: authUser.id },
    })) as typeof user;
  } catch (error) {
    strapi.log.error('[Policy.is-active-user] Falha ao consultar usuario', {
      userId: authUser.id,
      error,
    });
    throw new ApplicationError('Falha ao validar usuario autenticado', {
      code: 'POLICY_ACTIVE_USER_LOOKUP_FAILED',
      policy: 'is-active-user',
    });
  }

  if (!user) {
    throw new UnauthorizedError('Usuário não encontrado', {
      code: 'USER_NOT_FOUND',
      policy: 'is-active-user',
      userId: authUser.id,
    });
  }

  if (user.blocked) {
    throw new PolicyError('Usuário bloqueado', {
      code: 'USER_BLOCKED',
      policy: 'is-active-user',
      userId: authUser.id,
    });
  }

  // If the field exists and is explicitly false, block the request.
  if (user.is_active === false) {
    throw new PolicyError('Usuário inativo', {
      code: 'USER_INACTIVE',
      policy: 'is-active-user',
      userId: authUser.id,
    });
  }

  return true;
};
