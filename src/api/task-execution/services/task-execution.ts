import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { releaseDependentExecutions } from './dependency-release';
import { syncTrackAssignmentProgress as syncProgress } from './progress';
import type { TaskExecutionEntity, TrackAssignmentEntity } from './types';
import type { TaskSnapshot } from '../../track/services/track-versioning';
import { toWhere, type RelationReference } from '../../../utils/relation-reference';

const { ApplicationError, ForbiddenError, NotFoundError, ValidationError } = errors;

const nowIso = () => new Date().toISOString();

type UploadFile = {
  id: number;
  provider?: string;
  formats?: Record<string, unknown> | null;
};

type AttachEvidenceParams = {
  executionReference: RelationReference;
  userId: number;
  files: unknown;
  evidenceType?: 'file' | 'link' | null;
  externalUrl?: string | null;
  notes?: string | null;
};

type RemoveEvidenceParams = {
  executionReference: RelationReference;
  evidenceReference: RelationReference;
  userId: number;
};

type EvidenceUploadInput = {
  size?: number;
  mimetype?: string | null;
  type?: string | null;
  originalFilename?: string | null;
  name?: string | null;
};

const MAX_EVIDENCES_PER_EXECUTION = 5;
const MAX_EVIDENCE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EVIDENCE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);
const ALLOWED_EVIDENCE_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png']);
const EVIDENCE_MUTABLE_STATUSES = new Set(['available', 'in_progress', 'rejected']);
const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};

const normalizeFiles = (files: unknown) => {
  if (!files) {
    return [];
  }

  return Array.isArray(files) ? files : [files];
};

const validateEvidenceFiles = (
  files: unknown[],
  existingEvidenceCount: number,
  executionId: number
) => {
  if (
    files.length === 0 ||
    files.some((file) => !file || Number((file as EvidenceUploadInput).size ?? 0) <= 0)
  ) {
    throw new ValidationError('Arquivo de evidencia obrigatorio', {
      code: 'TASK_EVIDENCE_FILE_REQUIRED',
      executionId,
    });
  }

  if (existingEvidenceCount + files.length > MAX_EVIDENCES_PER_EXECUTION) {
    throw new ValidationError('Limite de evidencias excedido', {
      code: 'TASK_EVIDENCE_LIMIT_EXCEEDED',
      executionId,
      limit: MAX_EVIDENCES_PER_EXECUTION,
      existingEvidenceCount,
      requestedFileCount: files.length,
    });
  }

  for (const rawFile of files) {
    const file = rawFile as EvidenceUploadInput;
    const size = Number(file.size ?? 0);
    const mime = (file.mimetype ?? file.type ?? '').toLowerCase();
    const filename = file.originalFilename ?? file.name ?? '';
    const extension = filename.includes('.')
      ? filename.split('.').pop()?.toLowerCase() ?? ''
      : '';

    if (size > MAX_EVIDENCE_SIZE_BYTES) {
      throw new ValidationError('Arquivo de evidencia excede o tamanho maximo de 10 MB', {
        code: 'TASK_EVIDENCE_FILE_TOO_LARGE',
        executionId,
        filename,
        maxSizeBytes: MAX_EVIDENCE_SIZE_BYTES,
      });
    }

    if (
      !ALLOWED_EVIDENCE_MIME_TYPES.has(mime) ||
      !ALLOWED_EVIDENCE_EXTENSIONS.has(extension)
    ) {
      throw new ValidationError('Tipo de arquivo de evidencia nao permitido', {
        code: 'TASK_EVIDENCE_FILE_TYPE_NOT_ALLOWED',
        executionId,
        filename,
        mime,
        allowedExtensions: [...ALLOWED_EVIDENCE_EXTENSIONS],
      });
    }
  }
};

const findOwnedExecution = async (
  reference: RelationReference,
  userId: number,
  populateEvidences = false
) => {
  const where = toWhere(reference);

  if (!where) {
    throw new ValidationError('Identificador da execucao invalido', {
      code: 'TASK_EXECUTION_ID_INVALID',
      reference,
    });
  }

  const execution = (await strapi.db.query('api::task-execution.task-execution').findOne({
    where,
    populate: {
      track_assignment: {
        populate: ['user'],
      },
      ...(populateEvidences ? { evidences: true } : {}),
    },
  })) as
    | {
        id: number;
        documentId?: string | null;
        execution_status?: string | null;
        track_assignment?: TaskExecutionEntity['track_assignment'];
        task_snapshot?: TaskExecutionEntity['task_snapshot'];
        evidences?: Array<{ id: number }> | null;
      }
    | null;

  if (!execution) {
    throw new NotFoundError('Execucao da tarefa nao encontrada', {
      code: 'TASK_EXECUTION_NOT_FOUND',
      reference,
    });
  }

  if (execution.track_assignment?.user?.id !== userId) {
    throw new ForbiddenError('Usuario sem acesso a esta tarefa', {
      code: 'TASK_EXECUTION_FORBIDDEN',
      executionId: execution.id,
      userId,
    });
  }

  return execution;
};

const assertEvidenceMutationAllowed = (
  execution: {
    id: number;
    execution_status?: string | null;
    task_snapshot?: TaskExecutionEntity['task_snapshot'];
  },
  operation: 'anexar' | 'remover'
) => {
  if (!execution.task_snapshot?.requiresEvidence) {
    throw new ValidationError('Esta tarefa nao aceita evidencias', {
      code: 'TASK_EVIDENCE_NOT_REQUIRED',
      executionId: execution.id,
    });
  }

  if (!EVIDENCE_MUTABLE_STATUSES.has(execution.execution_status ?? '')) {
    throw new ValidationError(`Nao e possivel ${operation} evidencia nesta tarefa`, {
      code: 'TASK_EVIDENCE_MUTATION_NOT_ALLOWED',
      executionId: execution.id,
      status: execution.execution_status,
      allowedStatuses: [...EVIDENCE_MUTABLE_STATUSES],
    });
  }
};

const getTaskExecutionState = (task: TaskSnapshot) => {
  const hasDependencies = task.dependsOn.length > 0;

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

const hasValidEvidence = (evidence: NonNullable<TaskExecutionEntity['evidences']>[number]) =>
  evidence.evidence_type === 'link'
    ? isHttpUrl(evidence.external_url ?? '')
    : Boolean(evidence.file?.id);

export default factories.createCoreService('api::task-execution.task-execution', () => ({
  async createExecutionsForAssignment(trackAssignment: TrackAssignmentEntity) {
    if (!trackAssignment.track_snapshot) {
      strapi.log.warn('[TaskExecutionService.createExecutionsForAssignment] Snapshot ausente', {
        trackAssignmentId: trackAssignment.id,
      });
      return [];
    }

    const tasks = trackAssignment.track_snapshot.tasks;
    const createdExecutions = [];

    for (const task of tasks) {
      const state = getTaskExecutionState(task);
      const sourceTask = await strapi.db.query('api::task.task').findOne({
        where: { documentId: task.sourceDocumentId },
      });
      const execution = await strapi.db.query('api::task-execution.task-execution').create({
        data: {
          track_assignment: trackAssignment.id,
          task: sourceTask?.id ?? null,
          task_source_document_id: task.sourceDocumentId,
          task_snapshot: task,
          execution_status: state.execution_status,
          released_at: state.released_at,
          completed_at: null,
          notes: null,
          review_feedback: null,
          validation_status: 'pending',
          validated_at: null,
          validated_by: null,
        },
      });

      createdExecutions.push(execution);
    }

    return createdExecutions;
  },

  async completeExecution(executionReference: RelationReference, userId: number) {
    return strapi.db.transaction(async ({ trx }) => {
      const executionWhere = toWhere(executionReference);

      if (!executionWhere) {
        throw new ValidationError('Identificador da execucao invalido', {
          code: 'TASK_EXECUTION_ID_INVALID',
          executionReference,
        });
      }

      const initialExecution = await strapi.db
        .query('api::task-execution.task-execution')
        .findOne({ where: executionWhere });

      if (!initialExecution) {
        throw new NotFoundError('Execucao da tarefa nao encontrada', {
          code: 'TASK_EXECUTION_NOT_FOUND',
          executionReference,
        });
      }

      await trx('task_executions').where({ id: initialExecution.id }).forUpdate().first('id');

      const execution = (await strapi.db.query('api::task-execution.task-execution').findOne({
        where: { id: initialExecution.id },
        populate: {
          track_assignment: {
            populate: ['user'],
          },
          evidences: {
            populate: ['file'],
          },
        },
      })) as
      | {
          id: TaskExecutionEntity['id'];
          execution_status?: TaskExecutionEntity['execution_status'];
          track_assignment?: TaskExecutionEntity['track_assignment'];
          task_snapshot?: TaskExecutionEntity['task_snapshot'];
          evidences?: TaskExecutionEntity['evidences'];
        }
      | null;

      if (!execution) {
        throw new NotFoundError('Execucao da tarefa nao encontrada', {
          code: 'TASK_EXECUTION_NOT_FOUND',
          executionReference,
        });
      }

      if (execution.track_assignment?.user?.id !== userId) {
        throw new ForbiddenError('Usuario sem acesso a esta tarefa', {
          code: 'TASK_EXECUTION_FORBIDDEN',
          executionId: execution.id,
          userId,
        });
      }

      const isRejectedResubmission = execution.execution_status === 'rejected';
      const statusAllowed =
        ['available', 'in_progress'].includes(execution.execution_status ?? '') ||
        (isRejectedResubmission && execution.task_snapshot?.requiresManualApproval === true);

      if (!statusAllowed) {
        throw new ValidationError('Tarefa ainda nao pode ser concluida', {
          code: 'TASK_EXECUTION_NOT_AVAILABLE',
          executionId: execution.id,
          status: execution.execution_status,
        });
      }

      if (
        execution.task_snapshot?.requiresEvidence &&
        !(execution.evidences ?? []).some(hasValidEvidence)
      ) {
        throw new ValidationError('Esta tarefa exige evidencia valida antes da conclusao', {
          code: 'TASK_EVIDENCE_REQUIRED',
          executionId: execution.id,
          userId,
        });
      }

      if (!execution.track_assignment?.id) {
        throw new ApplicationError('Execucao sem atribuicao de trilha vinculada', {
          code: 'TASK_EXECUTION_ASSIGNMENT_MISSING',
          executionId: execution.id,
        });
      }

      if (execution.task_snapshot?.requiresManualApproval) {
        await strapi.db.query('api::task-execution.task-execution').update({
          where: { id: execution.id },
          data: {
            execution_status: 'submitted',
            validation_status: 'pending',
            completed_at: null,
            validated_at: null,
            validated_by: null,
            review_feedback: null,
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
          review_feedback: null,
        },
      });

      await releaseDependentExecutions(execution.track_assignment.id);
      await syncProgress(execution.track_assignment.id);
    });
  },

  async syncTrackAssignmentProgress(trackAssignmentId: number) {
    await syncProgress(trackAssignmentId);
  },

  async attachEvidenceToExecution({
    executionReference,
    userId,
    files,
    evidenceType = null,
    externalUrl = null,
    notes = null,
  }: AttachEvidenceParams) {
    const fileList = normalizeFiles(files);
    const execution = await findOwnedExecution(executionReference, userId, true);
    assertEvidenceMutationAllowed(execution, 'anexar');
    const normalizedUrl = externalUrl?.trim() ?? '';
    const resolvedType = evidenceType ?? (fileList.length > 0 ? 'file' : 'link');

    if (resolvedType === 'link') {
      if (fileList.length > 0) {
        throw new ValidationError('Evidencia por link nao aceita arquivo', {
          code: 'TASK_EVIDENCE_LINK_FILE_NOT_ALLOWED',
          executionId: execution.id,
        });
      }

      if (!isHttpUrl(normalizedUrl)) {
        throw new ValidationError('Evidencia por link exige URL HTTP ou HTTPS', {
          code: 'TASK_EVIDENCE_URL_REQUIRED',
          executionId: execution.id,
        });
      }

      if ((execution.evidences?.length ?? 0) + 1 > MAX_EVIDENCES_PER_EXECUTION) {
        throw new ValidationError('Limite de evidencias excedido', {
          code: 'TASK_EVIDENCE_LIMIT_EXCEEDED',
          executionId: execution.id,
          limit: MAX_EVIDENCES_PER_EXECUTION,
        });
      }

      const evidence = await strapi.service('api::task-evidence.task-evidence').create({
        data: {
          task_execution: execution.id,
          evidence_type: 'link',
          external_url: normalizedUrl,
          file: null,
          submitted_by: userId,
          notes,
        },
        populate: ['file', 'submitted_by', 'task_execution'],
      });

      return [evidence];
    }

    if (resolvedType !== 'file') {
      throw new ValidationError('Tipo de evidencia invalido', {
        code: 'TASK_EVIDENCE_TYPE_INVALID',
        executionId: execution.id,
        evidenceType: resolvedType,
      });
    }

    if (normalizedUrl) {
      throw new ValidationError('Evidencia de arquivo nao aceita URL externa', {
        code: 'TASK_EVIDENCE_FILE_URL_NOT_ALLOWED',
        executionId: execution.id,
      });
    }

    validateEvidenceFiles(fileList, execution.evidences?.length ?? 0, execution.id);

    const uploadedFiles = (await strapi.plugin('upload').service('upload').upload({
      data: {},
      files: fileList,
    })) as UploadFile[];

    const createdEvidences = [];

    try {
      for (const uploadedFile of uploadedFiles) {
        const evidence = await strapi.service('api::task-evidence.task-evidence').create({
          data: {
            task_execution: execution.id,
            evidence_type: 'file',
            file: uploadedFile.id,
            external_url: null,
            submitted_by: userId,
            notes,
          },
          populate: ['file', 'submitted_by', 'task_execution'],
        });

        createdEvidences.push(evidence);
      }
    } catch (error) {
      await Promise.allSettled(
        uploadedFiles.map((file) =>
          strapi.plugin('upload').service('upload').remove(file)
        )
      );
      throw error;
    }

    return createdEvidences;
  },

  async removeEvidenceFromExecution({
    executionReference,
    evidenceReference,
    userId,
  }: RemoveEvidenceParams) {
    const execution = await findOwnedExecution(executionReference, userId);
    assertEvidenceMutationAllowed(execution, 'remover');
    const evidenceWhere = toWhere(evidenceReference);

    if (!evidenceWhere) {
      throw new ValidationError('Identificador de evidencia invalido', {
        code: 'TASK_EVIDENCE_ID_INVALID',
        evidenceReference,
      });
    }

    const evidence = await strapi.db.query('api::task-evidence.task-evidence').findOne({
      where: evidenceWhere,
      populate: ['file', 'submitted_by', 'task_execution'],
    });

    if (!evidence || evidence.task_execution?.id !== execution.id) {
      throw new NotFoundError('Evidencia nao encontrada nesta execucao', {
        code: 'TASK_EVIDENCE_NOT_FOUND',
        executionId: execution.id,
        evidenceReference,
      });
    }

    if (evidence.submitted_by?.id !== userId) {
      throw new ForbiddenError('Usuario sem permissao para remover esta evidencia', {
        code: 'TASK_EVIDENCE_REMOVE_FORBIDDEN',
        executionId: execution.id,
        evidenceId: evidence.id,
        userId,
      });
    }

    await strapi.db.query('api::task-evidence.task-evidence').delete({
      where: { id: evidence.id },
    });

    if (evidence.file) {
      try {
        await strapi.plugin('upload').service('upload').remove(evidence.file);
      } catch (error) {
        strapi.log.error('[TaskExecutionService.removeEvidenceFromExecution] Arquivo orfao', {
          executionId: execution.id,
          evidenceId: evidence.id,
          fileId: evidence.file.id,
          error,
        });
      }
    }
  },

  async listExecutionsForAssignment(trackAssignmentId: number) {
    const executions = await strapi.db.query('api::task-execution.task-execution').findMany({
      where: {
        track_assignment: {
          id: trackAssignmentId,
        },
      },
      populate: {
        evidences: {
          populate: ['file', 'submitted_by'],
        },
        validated_by: true,
      },
    });

    return executions
      .map((execution) => ({
        ...execution,
        task_snapshot: execution.task_snapshot
          ? {
              ...(execution.task_snapshot as TaskSnapshot),
              materials: Array.isArray(
                (execution.task_snapshot as Partial<TaskSnapshot>).materials
              )
                ? (execution.task_snapshot as TaskSnapshot).materials
                : [],
            }
          : execution.task_snapshot,
      }))
      .sort(
      (left, right) =>
        ((left.task_snapshot as TaskSnapshot | null)?.orderIndex ?? 0) -
        ((right.task_snapshot as TaskSnapshot | null)?.orderIndex ?? 0)
      );
  },

  async reviewExecution(
    executionReference: RelationReference,
    reviewerUserId: number,
    decision: 'approve' | 'reject',
    feedback?: string | null
  ) {
    return strapi.db.transaction(async ({ trx }) => {
      const where = toWhere(executionReference);

      if (!where) {
        throw new ValidationError('Identificador da execucao invalido', {
          code: 'TASK_EXECUTION_ID_INVALID',
          executionReference,
        });
      }

      const initialExecution = await strapi.db
        .query('api::task-execution.task-execution')
        .findOne({ where });

      if (!initialExecution) {
        throw new NotFoundError('Execucao da tarefa nao encontrada', {
          code: 'TASK_EXECUTION_NOT_FOUND',
          executionReference,
        });
      }

      await trx('task_executions').where({ id: initialExecution.id }).forUpdate().first('id');

      const execution = (await strapi.db
        .query('api::task-execution.task-execution')
        .findOne({
          where: { id: initialExecution.id },
          populate: ['track_assignment'],
        })) as {
        id: number;
        execution_status?: string | null;
        task_snapshot?: TaskSnapshot | null;
        track_assignment?: { id: number } | null;
      } | null;

      if (
        !execution ||
        execution.execution_status !== 'submitted' ||
        execution.task_snapshot?.requiresManualApproval !== true
      ) {
        throw new ValidationError('Execucao nao esta aguardando avaliacao manual', {
          code: 'TASK_EXECUTION_REVIEW_NOT_ALLOWED',
          executionId: initialExecution.id,
          status: execution?.execution_status,
        });
      }

      if (!execution.track_assignment?.id) {
        throw new ApplicationError('Execucao sem atribuicao de trilha vinculada', {
          code: 'TASK_EXECUTION_ASSIGNMENT_MISSING',
          executionId: execution.id,
        });
      }

      const normalizedFeedback = feedback?.trim() || null;

      if (decision === 'reject' && !normalizedFeedback) {
        throw new ValidationError('Motivo da rejeicao e obrigatorio', {
          code: 'TASK_EXECUTION_REJECTION_FEEDBACK_REQUIRED',
          executionId: execution.id,
        });
      }

      await strapi.db.query('api::task-execution.task-execution').update({
        where: { id: execution.id },
        data: {
          execution_status: decision === 'approve' ? 'completed' : 'rejected',
          validation_status: decision === 'approve' ? 'approved' : 'rejected',
          completed_at: decision === 'approve' ? nowIso() : null,
          validated_at: nowIso(),
          validated_by: reviewerUserId,
          review_feedback: normalizedFeedback,
        },
      });

      if (decision === 'approve') {
        await releaseDependentExecutions(execution.track_assignment.id);
      }

      await syncProgress(execution.track_assignment.id);

      return strapi.db.query('api::task-execution.task-execution').findOne({
        where: { id: execution.id },
        populate: {
          track_assignment: true,
          validated_by: true,
          evidences: {
            populate: ['file', 'submitted_by'],
          },
        },
      });
    });
  },
}));
