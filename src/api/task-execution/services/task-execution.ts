import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { releaseDependentExecutions } from './dependency-release';
import { syncTrackAssignmentProgress as syncProgress } from './progress';
import { getTasksForTrack } from './task-selection';
import type { TaskEntity, TaskExecutionEntity, TrackAssignmentEntity } from './types';

const { ApplicationError, ForbiddenError, NotFoundError, ValidationError } = errors;

const nowIso = () => new Date().toISOString();

type UploadFile = {
  id: number;
};

type AttachEvidenceParams = {
  executionId: number;
  userId: number;
  files: unknown;
  notes?: string | null;
};

const normalizeFiles = (files: unknown) => {
  if (!files) {
    return [];
  }

  return Array.isArray(files) ? files : [files];
};

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
        evidences: true,
      },
    })) as
      | {
          id: TaskExecutionEntity['id'];
          execution_status?: TaskExecutionEntity['execution_status'];
          track_assignment?: TaskExecutionEntity['track_assignment'];
          task?: TaskExecutionEntity['task'];
          evidences?: TaskExecutionEntity['evidences'];
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

    if (execution.task?.requires_evidence && (execution.evidences?.length ?? 0) === 0) {
      throw new ValidationError('Esta tarefa exige evidencia antes da conclusao', {
        code: 'TASK_EVIDENCE_REQUIRED',
        executionId,
        userId,
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

  async attachEvidenceToExecution({ executionId, userId, files, notes = null }: AttachEvidenceParams) {
    const fileList = normalizeFiles(files);

    if (fileList.length === 0 || fileList.some((file) => !file || (file as { size?: number }).size === 0)) {
      throw new ValidationError('Arquivo de evidencia obrigatorio', {
        code: 'TASK_EVIDENCE_FILE_REQUIRED',
        executionId,
      });
    }

    const execution = (await strapi.db.query('api::task-execution.task-execution').findOne({
      where: { id: executionId },
      populate: {
        track_assignment: {
          populate: ['user'],
        },
        task: true,
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

    if (['locked', 'completed'].includes(execution.execution_status ?? '')) {
      throw new ValidationError('Nao e possivel anexar evidencia nesta tarefa', {
        code: 'TASK_EVIDENCE_UPLOAD_NOT_ALLOWED',
        executionId,
        status: execution.execution_status,
      });
    }

    const uploadedFiles = (await strapi.plugin('upload').service('upload').upload({
      data: {},
      files: fileList,
    })) as UploadFile[];

    const createdEvidences = [];

    for (const uploadedFile of uploadedFiles) {
      const evidence = await strapi.service('api::task-evidence.task-evidence').create({
        data: {
          task_execution: execution.id,
          file: uploadedFile.id,
          submitted_by: userId,
          notes,
        },
        populate: ['file', 'submitted_by', 'task_execution'],
      });

      createdEvidences.push(evidence);
    }

    return createdEvidences;
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
        evidences: {
          populate: ['file', 'submitted_by'],
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
