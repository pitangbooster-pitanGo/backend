import { errors } from '@strapi/utils';

const { PolicyError, UnauthorizedError } = errors;

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
    throw new UnauthorizedError('Autenticação obrigatória');
  }

  const user = (await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: authUser.id },
  })) as {
    blocked?: boolean;
    is_active?: boolean;
  } | null;

  if (!user) {
    throw new UnauthorizedError('Usuário não encontrado');
  }

  if (user.blocked) {
    throw new PolicyError('Usuário bloqueado');
  }

  // If the field exists and is explicitly false, block the request.
  if (user.is_active === false) {
    throw new PolicyError('Usuário inativo');
  }

  return true;
};
