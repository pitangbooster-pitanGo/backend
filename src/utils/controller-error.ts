import { errors } from '@strapi/utils';

export const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const rethrowStrapiError = (error: unknown) => {
  if (error instanceof errors.ApplicationError || error instanceof errors.HttpError) {
    throw error;
  }
};

export const logControllerError = (
  scope: string,
  error: unknown,
  context?: Record<string, unknown>
) => {
  strapi.log.error(`[${scope}] ${getErrorMessage(error, 'Erro inesperado')}`, {
    ...context,
    error,
  });
};
