
import { factories } from '@strapi/strapi';

import { validateTaskDependencies } from '../services/task-dependency';
import { findEntity } from '../../../utils/relation-reference';
import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';
import { createNextTrackSnapshot } from '../../track/services/track-versioning';
import { validateTaskMaterials } from '../services/task-material';
import { recordAuditLog } from '../../../utils/audit-log';

type TaskAuditSnapshot = {
  id: number;
  documentId?: string | null;
  track?: { id: number } | null;
  depends_on?: Array<{ id: number }> | null;
};

const TASK_AUDIT_POPULATE = ['track', 'depends_on'];

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
      await validateTaskMaterials(sanitizedData);

      ctx.request.body = {
        ...body,
        data: sanitizedData,
      };

      await validateTaskDependencies(ctx.request.body as RequestBody);

      return strapi.db.transaction(async ({ trx }) => {
        const response = await super.create(ctx);
        const taskReference = responseReference(response);
        const createdTask = await findEntity<TaskAuditSnapshot>(
          'api::task.task',
          taskReference,
          TASK_AUDIT_POPULATE
        );

        if (createdTask?.track?.id) {
          await createNextTrackSnapshot(createdTask.track.id, ctx.state.user?.id, trx);
        }

        await recordAuditLog({
          entityType: 'task',
          entityId: createdTask?.documentId ?? (typeof taskReference === 'string' ? taskReference : null),
          action: 'create',
          actorId: ctx.state.user?.id,
          after: createdTask,
        });

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
      await validateTaskMaterials(sanitizedData);

      ctx.request.body = {
        ...body,
        data: sanitizedData,
      };

      const currentTask = await findEntity<TaskAuditSnapshot & { order_index: number }>(
        'api::task.task',
        ctx.params.id as string,
        TASK_AUDIT_POPULATE
      );

      if (!currentTask) {
        return ctx.notFound('Tarefa nao encontrada', {
          code: 'TASK_NOT_FOUND',
          taskId: ctx.params.id,
        });
      }

      await validateTaskDependencies(ctx.request.body as RequestBody, currentTask);

      return strapi.db.transaction(async ({ trx }) => {
        const response = await super.update(ctx);
        const updatedTask = await findEntity<TaskAuditSnapshot>(
          'api::task.task',
          ctx.params.id as string,
          TASK_AUDIT_POPULATE
        );
        const affectedTrackIds = new Set(
          [currentTask.track?.id, updatedTask?.track?.id].filter(
            (id): id is number => typeof id === 'number'
          )
        );

        for (const trackId of affectedTrackIds) {
          await createNextTrackSnapshot(trackId, ctx.state.user?.id, trx);
        }

        await recordAuditLog({
          entityType: 'task',
          entityId: currentTask.documentId ?? (ctx.params.id as string),
          action: 'update',
          actorId: ctx.state.user?.id,
          before: currentTask,
          after: updatedTask,
        });

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
      const currentTask = await findEntity<TaskAuditSnapshot>(
        'api::task.task',
        ctx.params.id as string,
        TASK_AUDIT_POPULATE
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

        await recordAuditLog({
          entityType: 'task',
          entityId: currentTask.documentId ?? (ctx.params.id as string),
          action: 'delete',
          actorId: ctx.state.user?.id,
          before: currentTask,
        });

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
