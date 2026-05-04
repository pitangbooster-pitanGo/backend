import { factories } from '@strapi/strapi';

type TaskEntity = {
  id: number;
  order_index: number;
  depends_on?: Array<{ id: number }> | null;
};

type TrackAssignmentEntity = {
  id: number;
  status?: string | null;
  progress_percentage?: number | string | null;
  started_at?: string | null;
  completed_at?: string | null;
  track?: {
    id: number;
  } | null;
};

const nowIso = () => new Date().toISOString();

const getTaskExecutionState = (task: TaskEntity) => {
  const hasDependencies = Array.isArray(task.depends_on) && task.depends_on.length > 0;

  if (hasDependencies) {
    return {
      execution_status: 'locked',
      released_at: null,
    };
  }

  return {
    execution_status: 'available',
    released_at: nowIso(),
  };
};

const getTasksForTrack = async (trackId: number) =>
  (await strapi.db.query('api::task.task').findMany({
    where: {
      track: {
        id: trackId,
      },
      is_active: {
        $ne: false,
      },
    },
    populate: ['depends_on'],
    orderBy: {
      order_index: 'asc',
    },
  })) as TaskEntity[];

const updateTrackAssignmentProgress = async (trackAssignmentId: number) => {
  const currentAssignment = (await strapi
    .db.query('api::track-assignment.track-assignment')
    .findOne({
      where: { id: trackAssignmentId },
    })) as TrackAssignmentEntity | null;
  const executions = (await strapi.db.query('api::task-execution.task-execution').findMany({
    where: {
      track_assignment: {
        id: trackAssignmentId,
      },
    },
  })) as Array<{
    id: number;
    execution_status?: string | null;
  }>;

  const total = executions.length;
  const completed = executions.filter(
    (execution) => execution.execution_status === 'completed'
  ).length;
  const progress = total === 0 ? 0 : Number(((completed / total) * 100).toFixed(2));
  const isCompleted = total > 0 && completed === total;

  await strapi.db.query('api::track-assignment.track-assignment').update({
    where: { id: trackAssignmentId },
    data: {
      status: isCompleted ? 'completed' : completed > 0 ? 'in_progress' : 'not_started',
      completed_at: isCompleted ? nowIso() : null,
      started_at:
        completed > 0 ? currentAssignment?.started_at ?? nowIso() : currentAssignment?.started_at ?? null,
      progress_percentage: progress,
    },
  });
};

const releaseDependentExecutions = async (trackAssignmentId: number) => {
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

export default factories.createCoreService('api::task-execution.task-execution', () => ({
  async createExecutionsForAssignment(trackAssignment: TrackAssignmentEntity) {
    if (!trackAssignment.track?.id) {
      return [];
    }

    const tasks = await getTasksForTrack(trackAssignment.track.id);
    const createdExecutions = [];

    for (const task of tasks) {
      const state = getTaskExecutionState(task);
      const execution = await strapi.db.query('api::task-execution.task-execution').create({
        data: {
          track_assignment: trackAssignment.id,
          task: task.id,
          execution_status: state.execution_status,
          released_at: state.released_at,
          completed_at: null,
          notes: null,
          validation_status: 'pending',
          validated_at: null,
          validated_by: null,
        },
      });

      createdExecutions.push(execution);
    }

    return createdExecutions;
  },

  async completeExecution(executionId: number, userId: number) {
    const execution = (await strapi.db.query('api::task-execution.task-execution').findOne({
      where: { id: executionId },
      populate: {
        track_assignment: {
          populate: ['user'],
        },
        task: {
          populate: ['depends_on'],
        },
      },
    })) as
      | {
          id: number;
          execution_status?: string | null;
          track_assignment?: {
            id: number;
            user?: { id: number } | null;
          } | null;
        }
      | null;

    if (!execution) {
      throw new Error('Task execution not found');
    }

    if (execution.track_assignment?.user?.id !== userId) {
      throw new Error('User cannot complete this task execution');
    }

    if (!['available', 'in_progress'].includes(execution.execution_status ?? '')) {
      throw new Error('Task execution is not available for completion');
    }

    await strapi.db.query('api::task-execution.task-execution').update({
      where: { id: execution.id },
      data: {
        execution_status: 'completed',
        completed_at: nowIso(),
      },
    });

    await releaseDependentExecutions(execution.track_assignment.id);
    await updateTrackAssignmentProgress(execution.track_assignment.id);
  },

  async syncTrackAssignmentProgress(trackAssignmentId: number) {
    await updateTrackAssignmentProgress(trackAssignmentId);
  },

  async listExecutionsForAssignment(trackAssignmentId: number) {
    return strapi.db.query('api::task-execution.task-execution').findMany({
      where: {
        track_assignment: {
          id: trackAssignmentId,
        },
      },
      populate: {
        task: {
          populate: ['depends_on'],
        },
        validated_by: true,
      },
      orderBy: {
        task: {
          order_index: 'asc',
        },
      },
    });
  },
}));
