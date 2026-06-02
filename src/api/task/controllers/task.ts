
import { factories } from '@strapi/strapi';

import { validateTaskDependencies } from '../services/task-dependency';
import { findEntity } from '../../../utils/relation-reference';
import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';

type RequestBody = {
  data?: Record<string, unknown>;
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

      return super.create(ctx);
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

      return super.update(ctx);
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
}));
