
import { factories } from '@strapi/strapi';

import { validateTaskDependencies } from '../services/task-dependency';
import { findEntity } from '../../../utils/relation-reference';
import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';
import { createNextTrackSnapshot } from '../../track/services/track-versioning';

type RequestBody = {
  data?: Record<string, unknown>;
};

const responseReference = (response: unknown) => {
  const data = (response as { data?: { id?: number; documentId?: string } })?.data;
  return data?.documentId ?? data?.id ?? null;
};

export default factories.createCoreController('api::task.task', () => ({
  async create(ctx) {
    try {
      const body = (ctx.request.body ?? {}) as RequestBody;
      const data = body.data ?? {};

      await this.validateInput(data, ctx);
      const sanitizedData = (await this.sanitizeInput(data, ctx)) as Record<string, unknown>;

      ctx.request.body = {
        ...body,
        data: sanitizedData,
      };

      await validateTaskDependencies(ctx.request.body as RequestBody);

      return strapi.db.transaction(async ({ trx }) => {
        const response = await super.create(ctx);
        const taskReference = responseReference(response);
        const createdTask = await findEntity<{ track?: { id: number } | null }>(
          'api::task.task',
          taskReference,
          ['track']
        );

        if (createdTask?.track?.id) {
          await createNextTrackSnapshot(createdTask.track.id, ctx.state.user?.id, trx);
        }

        return response;
      });
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task.create', error, {
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao criar tarefa', {
        code: 'TASK_CREATE_FAILED',
      });
    }
  },

  async update(ctx) {
    try {
      const body = (ctx.request.body ?? {}) as RequestBody;
      const data = body.data ?? {};

      await this.validateInput(data, ctx);
      const sanitizedData = (await this.sanitizeInput(data, ctx)) as Record<string, unknown>;

      ctx.request.body = {
        ...body,
        data: sanitizedData,
      };

      const currentTask = await findEntity<{
        id: number;
        order_index: number;
        track?: { id: number } | null;
      }>('api::task.task', ctx.params.id as string, ['track']);

      if (!currentTask) {
        return ctx.notFound('Tarefa nao encontrada', {
          code: 'TASK_NOT_FOUND',
          taskId: ctx.params.id,
        });
      }

      await validateTaskDependencies(ctx.request.body as RequestBody, currentTask);

      return strapi.db.transaction(async ({ trx }) => {
        const response = await super.update(ctx);
        const updatedTask = await findEntity<{ track?: { id: number } | null }>(
          'api::task.task',
          ctx.params.id as string,
          ['track']
        );
        const affectedTrackIds = new Set(
          [currentTask.track?.id, updatedTask?.track?.id].filter(
            (id): id is number => typeof id === 'number'
          )
        );

        for (const trackId of affectedTrackIds) {
          await createNextTrackSnapshot(trackId, ctx.state.user?.id, trx);
        }

        return response;
      });
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task.update', error, {
        taskId: ctx.params.id,
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao atualizar tarefa', {
        code: 'TASK_UPDATE_FAILED',
        taskId: ctx.params.id,
      });
    }
  },

  async delete(ctx) {
    try {
      const currentTask = await findEntity<{ track?: { id: number } | null }>(
        'api::task.task',
        ctx.params.id as string,
        ['track']
      );

      if (!currentTask) {
        return ctx.notFound('Tarefa nao encontrada', {
          code: 'TASK_NOT_FOUND',
          taskId: ctx.params.id,
        });
      }

      return strapi.db.transaction(async ({ trx }) => {
        const response = await super.delete(ctx);

        if (currentTask.track?.id) {
          await createNextTrackSnapshot(currentTask.track.id, ctx.state.user?.id, trx);
        }

        return response;
      });
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task.delete', error, {
        taskId: ctx.params.id,
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao excluir tarefa', {
        code: 'TASK_DELETE_FAILED',
        taskId: ctx.params.id,
      });
    }
  },
}));
