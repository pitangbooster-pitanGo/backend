import { factories } from '@strapi/strapi';

const parseId = (value: string) => Number(value);

export default factories.createCoreController('api::task-execution.task-execution', () => ({
  async listForMyAssignment(ctx) {
    const authUser = ctx.state.user;
    const assignmentId = parseId(ctx.params.id);

    if (!authUser) {
      return ctx.unauthorized('Autenticacao obrigatoria');
    }

    const assignment = await strapi.db.query('api::track-assignment.track-assignment').findOne({
      where: { id: assignmentId },
      populate: ['user', 'track'],
    });

    if (!assignment) {
      return ctx.notFound('Atribuicao nao encontrada');
    }

    if (assignment.user?.id !== authUser.id) {
      return ctx.forbidden('Usuario sem acesso a esta atribuicao');
    }

    const executions = await strapi
      .service('api::task-execution.task-execution')
      .listExecutionsForAssignment(assignmentId);
    const sanitizedExecutions = await this.sanitizeOutput(executions, ctx);

    return this.transformResponse(sanitizedExecutions);
  },

  async complete(ctx) {
    const authUser = ctx.state.user;
    const executionId = parseId(ctx.params.id);

    if (!authUser) {
      return ctx.unauthorized('Autenticacao obrigatoria');
    }

    try {
      await strapi
        .service('api::task-execution.task-execution')
        .completeExecution(executionId, authUser.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao concluir tarefa';

      if (message === 'Task execution not found') {
        return ctx.notFound('Execucao da tarefa nao encontrada');
      }

      if (message === 'User cannot complete this task execution') {
        return ctx.forbidden('Usuario sem acesso a esta tarefa');
      }

      if (message === 'Task execution is not available for completion') {
        return ctx.badRequest('Tarefa ainda nao pode ser concluida');
      }

      return ctx.badRequest(message);
    }

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
  },
}));
