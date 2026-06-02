import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { releaseDependentExecutions } from './dependency-release';
import { syncTrackAssignmentProgress as syncProgress } from './progress';
import { getTasksForTrack } from './task-selection';
import type { TaskEntity, TaskExecutionEntity, TrackAssignmentEntity } from './types';

const { ApplicationError, ForbiddenError, NotFoundError, ValidationError } = errors;

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

export default factories.createCoreService('api::task-execution.task-execution', () => ({
  async createExecutionsForAssignment(trackAssignment: TrackAssignmentEntity) {
    if (!trackAssignment.track?.id) {
      strapi.log.warn('[TaskExecutionService.createExecutionsForAssignment] Track ausente', {
        trackAssignmentId: trackAssignment.id,
      });
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
          id: TaskExecutionEntity['id'];
          execution_status?: TaskExecutionEntity['execution_status'];
          track_assignment?: TaskExecutionEntity['track_assignment'];
          task?: TaskExecutionEntity['task'];
        }
      | null;

    if (!execution) {
      throw new NotFoundError('Execucao da tarefa nao encontrada', {
        code: 'TASK_EXECUTION_NOT_FOUND',
        executionId,
      });
    }

    if (execution.track_assignment?.user?.id !== userId) {
      throw new ForbiddenError('Usuario sem acesso a esta tarefa', {
        code: 'TASK_EXECUTION_FORBIDDEN',
        executionId,
        userId,
      });
    }

    if (!['available', 'in_progress'].includes(execution.execution_status ?? '')) {
      throw new ValidationError('Tarefa ainda nao pode ser concluida', {
        code: 'TASK_EXECUTION_NOT_AVAILABLE',
        executionId,
        status: execution.execution_status,
      });
    }

    if (!execution.track_assignment?.id) {
      throw new ApplicationError('Execucao sem atribuicao de trilha vinculada', {
        code: 'TASK_EXECUTION_ASSIGNMENT_MISSING',
        executionId,
      });
    }

    if (execution.task?.requires_manual_approval) {
      await strapi.db.query('api::task-execution.task-execution').update({
        where: { id: execution.id },
        data: {
          execution_status: 'submitted',
          validation_status: 'pending',
          completed_at: null,
          validated_at: null,
          validated_by: null,
        },
      });

      await syncProgress(execution.track_assignment.id);
      return;
    }

    await strapi.db.query('api::task-execution.task-execution').update({
      where: { id: execution.id },
      data: {
        execution_status: 'completed',
        validation_status: 'approved',
        completed_at: nowIso(),
      },
    });

    await releaseDependentExecutions(execution.track_assignment.id);
    await syncProgress(execution.track_assignment.id);
  },

  async syncTrackAssignmentProgress(trackAssignmentId: number) {
    await syncProgress(trackAssignmentId);
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
