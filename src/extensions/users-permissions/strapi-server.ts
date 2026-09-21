import { logEvent, logWarn } from '../../utils/logger';

type AuthContext = {
  request: { body?: { identifier?: unknown } };
  status?: number;
  body?: { user?: { id?: number } };
};

type AuthController = {
  callback: (ctx: AuthContext) => Promise<unknown>;
  [key: string]: unknown;
};

/**
 * Atenção: em `@strapi/plugin-users-permissions` os controllers são FACTORIES
 * (`({ strapi }) => ({ callback, ... })`), não objetos prontos. Sobrescrever
 * `plugin.controllers.auth.callback` diretamente não dá erro — apenas escreve
 * uma propriedade em uma função que ninguém lê, e o wrapper nunca roda.
 */
type ControllerFactory = (params: unknown) => AuthController;

type UsersPermissionsPlugin = {
  controllers: {
    auth: ControllerFactory;
  };
};

// O identificador vem do corpo da requisição e é escrito por quem tenta
// autenticar — limitar o tamanho evita que uma tentativa maliciosa infle o log.
const MAX_IDENTIFIER_LENGTH = 120;

const safeIdentifier = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  return value.slice(0, MAX_IDENTIFIER_LENGTH);
};

/**
 * Envolve POST /api/auth/local para registrar tentativas de login.
 *
 * Sem isto, uma sequência de tentativas com senha errada não deixa nenhum
 * rastro — é o sinal mais básico de ataque a credenciais.
 */
export default (plugin: UsersPermissionsPlugin) => {
  const createAuthController = plugin.controllers.auth;

  plugin.controllers.auth = (params: unknown) => {
    const controller = createAuthController(params);
    const originalCallback = controller.callback;

    controller.callback = async function callback(ctx: AuthContext) {
      const identifier = safeIdentifier(ctx.request.body?.identifier);

      try {
        const result = await originalCallback.call(this, ctx);

        // O users-permissions costuma lançar em caso de falha, mas alguns
        // caminhos apenas respondem 4xx — cobrimos os dois.
        if (typeof ctx.status === 'number' && ctx.status >= 400) {
          logWarn('auth.login', 'Tentativa de login rejeitada', {
            identifier,
            status: ctx.status,
          });
          return result;
        }

        logEvent('auth.login.succeeded', {
          identifier,
          authenticatedUserId: ctx.body?.user?.id ?? null,
        });

        return result;
      } catch (error) {
        logWarn('auth.login', 'Falha de autenticacao', {
          identifier,
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    return controller;
  };

  return plugin;
};
