import type { TaskSnapshot } from '../../track/services/track-versioning';

const nowIso = () => new Date().toISOString();

export const releaseDependentExecutions = async (trackAssignmentId: number) => {
  const executions = (await strapi.db.query('api::task-execution.task-execution').findMany({
    where: {
      track_assignment: {
        id: trackAssignmentId,
      },
    },
  })) as Array<{
    id: number;
    execution_status?: string | null;
    task_source_document_id?: string | null;
    task_snapshot?: TaskSnapshot | null;
  }>;

  const executionByTaskId = new Map<string, (typeof executions)[number]>();

  for (const execution of executions) {
    if (execution.task_source_document_id) {
      executionByTaskId.set(execution.task_source_document_id, execution);
    }
  }

  for (const execution of executions) {
    if (execution.execution_status !== 'locked' || !execution.task_snapshot) {
      continue;
    }

    const dependencies = execution.task_snapshot.dependsOn;
    const canRelease =
      dependencies.length > 0 &&
      dependencies.every((dependency) => {
        const dependencyExecution = executionByTaskId.get(dependency);
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
