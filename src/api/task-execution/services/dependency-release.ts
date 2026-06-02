import type { TaskEntity } from './types';

const nowIso = () => new Date().toISOString();

export const releaseDependentExecutions = async (trackAssignmentId: number) => {
  const executions = (await strapi.db.query('api::task-execution.task-execution').findMany({
    where: {
      track_assignment: {
        id: trackAssignmentId,
      },
    },
    populate: {
      task: {
        populate: ['depends_on'],
      },
    },
  })) as Array<{
    id: number;
    execution_status?: string | null;
    task?: TaskEntity | null;
  }>;

  const executionByTaskId = new Map<number, (typeof executions)[number]>();

  for (const execution of executions) {
    if (execution.task?.id) {
      executionByTaskId.set(execution.task.id, execution);
    }
  }

  for (const execution of executions) {
    if (execution.execution_status !== 'locked' || !execution.task) {
      continue;
    }

    const dependencies = execution.task.depends_on ?? [];
    const canRelease =
      dependencies.length > 0 &&
      dependencies.every((dependency) => {
        const dependencyExecution = executionByTaskId.get(dependency.id);
        return dependencyExecution?.execution_status === 'completed';
      });

    if (!canRelease) {
      continue;
    }

    await strapi.db.query('api::task-execution.task-execution').update({
      where: { id: execution.id },
      data: {
        execution_status: 'available',
        released_at: nowIso(),
      },
    });
  }
};
