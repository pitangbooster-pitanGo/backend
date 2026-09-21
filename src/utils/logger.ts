type LogContext = Record<string, unknown>;

export type SerializedError = {
  name?: string;
  message: string;
  stack?: string;
  code?: string;
  status?: number;
};

/**
 * Converte o erro em um objeto plano ANTES de entregá-lo ao winston.
 * Passar a instância de Error crua no metadata faz o stack se perder na
 * serialização (Error não tem propriedades próprias enumeráveis).
 */
export const serializeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    const details = (error as { details?: { code?: string } }).details;

    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: details?.code ?? (error as { code?: string }).code,
      status: (error as { status?: number }).status,
    };
  }

  return { message: String(error) };
};

/**
 * Correlação: o Strapi 5 mantém o ctx do Koa em um AsyncLocalStorage
 * (`strapi.requestContext`), então qualquer service alcança o requestId sem
 * precisar receber o ctx por parâmetro. Fora de uma requisição (bootstrap,
 * cron) devolve um objeto vazio.
 */
const requestScope = (): LogContext => {
  const ctx = strapi.requestContext?.get();

  if (!ctx) {
    return {};
  }

  return {
    requestId: ctx.state?.requestId,
    userId: ctx.state?.user?.id,
  };
};

const withScope = (context?: LogContext): LogContext => ({ ...requestScope(), ...context });

export const logInfo = (scope: string, message: string, context?: LogContext) => {
  strapi.log.info(`[${scope}] ${message}`, withScope(context));
};

export const logWarn = (scope: string, message: string, context?: LogContext) => {
  strapi.log.warn(`[${scope}] ${message}`, withScope(context));
};

export const logDebug = (scope: string, message: string, context?: LogContext) => {
  strapi.log.debug(`[${scope}] ${message}`, withScope(context));
};

export const logError = (scope: string, error: unknown, context?: LogContext) => {
  const serialized = serializeError(error);

  strapi.log.error(`[${scope}] ${serialized.message}`, {
    ...withScope(context),
    error: serialized,
  });
};

/**
 * Eventos de negócio bem-sucedidos (aprovação, atribuição, login...).
 * Marcados com `event` para permitir filtrar `event=*` no agregador e separar
 * a trilha de auditoria operacional do ruído de requisição.
 */
export const logEvent = (event: string, context?: LogContext) => {
  strapi.log.info(`[event] ${event}`, { ...withScope(context), event });
};
