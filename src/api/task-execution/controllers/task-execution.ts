import { factories } from '@strapi/strapi';

import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';

const parseId = (value: string) => {
  const parsedId = Number(value);

  return Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;
};

export default factories.createCoreController('api::task-execution.task-execution', () => ({
  async listForMyAssignment(ctx) {
    try {
      const authUser = ctx.state.user;
      const assignmentId = parseId(ctx.params.id);

      if (!authUser) {
        return ctx.unauthorized('Autenticacao obrigatoria', {
          code: 'AUTH_REQUIRED',
        });
      }

      if (assignmentId === null) {
        return ctx.badRequest('Identificador da atribuicao invalido', {
          code: 'TRACK_ASSIGNMENT_ID_INVALID',
          id: ctx.params.id,
        });
      }

      await this.validateQuery(ctx);
      await this.sanitizeQuery(ctx);

      const assignment = await strapi.db.query('api::track-assignment.track-assignment').findOne({
        where: { id: assignmentId },
        populate: ['user', 'track'],
      });

      if (!assignment) {
        return ctx.notFound('Atribuicao nao encontrada', {
          code: 'TRACK_ASSIGNMENT_NOT_FOUND',
          assignmentId,
        });
      }

      if (assignment.user?.id !== authUser.id) {
        return ctx.forbidden('Usuario sem acesso a esta atribuicao', {
          code: 'TRACK_ASSIGNMENT_FORBIDDEN',
          assignmentId,
          userId: authUser.id,
        });
      }

      const executions = await strapi
        .service('api::task-execution.task-execution')
        .listExecutionsForAssignment(assignmentId);
      const sanitizedExecutions = await this.sanitizeOutput(executions, ctx);

      return this.transformResponse(sanitizedExecutions);
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task-execution.listForMyAssignment', error, {
        assignmentId: ctx.params.id,
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao listar tarefas da atribuicao', {
        code: 'TASK_EXECUTIONS_LIST_FAILED',
        assignmentId: ctx.params.id,
      });
    }
  },

  async complete(ctx) {
    const authUser = ctx.state.user;
    const executionId = parseId(ctx.params.id);

    if (!authUser) {
      return ctx.unauthorized('Autenticacao obrigatoria', {
        code: 'AUTH_REQUIRED',
      });
    }

    if (executionId === null) {
      return ctx.badRequest('Identificador da execucao invalido', {
        code: 'TASK_EXECUTION_ID_INVALID',
        id: ctx.params.id,
      });
    }

    await this.validateQuery(ctx);
    await this.sanitizeQuery(ctx);

    try {
      await strapi
        .service('api::task-execution.task-execution')
        .completeExecution(executionId, authUser.id);
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task-execution.complete', error, {
        executionId,
        userId: authUser.id,
      });
      return ctx.internalServerError('Falha ao concluir tarefa', {
        code: 'TASK_EXECUTION_COMPLETE_FAILED',
        executionId,
      });
    }

    try {
      const execution = await strapi.db.query('api::task-execution.task-execution').findOne({
        where: { id: executionId },
        populate: {
          task: {
            populate: ['depends_on'],
          },
          track_assignment: true,
          validated_by: true,
        },
      });
      const sanitizedExecution = await this.sanitizeOutput(execution, ctx);

      return this.transformResponse(sanitizedExecution);
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task-execution.complete.response', error, {
        executionId,
        userId: authUser.id,
      });
      return ctx.internalServerError('Tarefa concluida, mas houve falha ao carregar a resposta', {
        code: 'TASK_EXECUTION_RESPONSE_LOAD_FAILED',
        executionId,
      });
    }
  },
}));
