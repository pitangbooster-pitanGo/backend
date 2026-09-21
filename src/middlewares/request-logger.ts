import { randomUUID } from 'node:crypto';
import type { Core } from '@strapi/strapi';

const REQUEST_ID_HEADER = 'x-request-id';

// O id vem de um header controlado pelo cliente e termina dentro de uma linha
// de log — restringir charset e tamanho evita injeção de conteúdo no log.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

// Rotas sem valor operacional que só poluiriam o log.
const IGNORED_PREFIXES = ['/uploads', '/favicon', '/admin/project-type', '/_health'];

type RequestLoggerConfig = {
  ignoredPrefixes?: string[];
};

const resolveRequestId = (headerValue: string | string[] | undefined): string => {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  return candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
};

const levelForStatus = (status: number): 'info' | 'warn' | 'error' => {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
};

const middleware: Core.MiddlewareFactory<RequestLoggerConfig> = (config = {}, { strapi }) => {
  const ignoredPrefixes = config.ignoredPrefixes ?? IGNORED_PREFIXES;

  return async (ctx, next) => {
    const requestId = resolveRequestId(ctx.request.header[REQUEST_ID_HEADER]);
    const startedAt = Date.now();

    // Disponibiliza o id para os utilitários de log (via strapi.requestContext)
    // e devolve ao cliente para que o front consiga citá-lo em um report de bug.
    ctx.state.requestId = requestId;
    ctx.set(REQUEST_ID_HEADER, requestId);

    try {
      await next();
    } finally {
      const path = ctx.request.path;

      if (!ignoredPrefixes.some((prefix) => path.startsWith(prefix))) {
        // ctx.state.user só é preenchido pelo middleware de autenticação, que
        // roda depois deste — por isso a leitura acontece aqui, no finally.
        const user = ctx.state.user as { id?: number; role?: { type?: string } } | undefined;

        // A camada de permissões do users-permissions nega antes das policies
        // de rota, então nem toda negação passa por `global::has-role`. Marcar
        // aqui dá um filtro único (`event=access.denied`) para todas elas.
        const isAccessDenial = ctx.status === 401 || ctx.status === 403;

        strapi.log[levelForStatus(ctx.status)](`${ctx.method} ${path} ${ctx.status}`, {
          requestId,
          method: ctx.method,
          path,
          status: ctx.status,
          durationMs: Date.now() - startedAt,
          userId: user?.id ?? null,
          role: user?.role?.type ?? null,
          ip: ctx.request.ip,
          ...(isAccessDenial ? { event: 'access.denied' } : {}),
        });
      }
    }
  };
};

export default middleware;
