import { errors } from '@strapi/utils';

import { logError } from './logger';

export const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const rethrowStrapiError = (error: unknown) => {
  if (error instanceof errors.ApplicationError || error instanceof errors.HttpError) {
    throw error;
  }
};

/**
 * Mantido com a mesma assinatura para não tocar nos ~25 call sites existentes.
 * A diferença é que agora delega para `logError`, que serializa o erro
 * (preservando stack e code) e anexa requestId + userId automaticamente.
 */
export const logControllerError = (
  scope: string,
  error: unknown,
  context?: Record<string, unknown>
) => {
  logError(scope, error, context);
};
