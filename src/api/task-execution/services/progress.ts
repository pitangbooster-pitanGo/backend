import { errors } from '@strapi/utils';

import type { TrackAssignmentEntity } from './types';

const { NotFoundError } = errors;

const nowIso = () => new Date().toISOString();

export const syncTrackAssignmentProgress = async (trackAssignmentId: number) => {
  const currentAssignment = (await strapi
    .db.query('api::track-assignment.track-assignment')
    .findOne({
      where: { id: trackAssignmentId },
    })) as TrackAssignmentEntity | null;

  if (!currentAssignment) {
    throw new NotFoundError('Atribuicao nao encontrada para sincronizar progresso', {
      code: 'TRACK_ASSIGNMENT_PROGRESS_NOT_FOUND',
      trackAssignmentId,
    });
  }

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
  const started = executions.some(
    (execution) =>
      execution.execution_status &&
      !['locked', 'available'].includes(execution.execution_status)
  );
  const progress = total === 0 ? 0 : Number(((completed / total) * 100).toFixed(2));
  const isCompleted = total > 0 && completed === total;

  await strapi.db.query('api::track-assignment.track-assignment').update({
    where: { id: trackAssignmentId },
    data: {
      status: isCompleted ? 'completed' : started ? 'in_progress' : 'not_started',
      completed_at: isCompleted ? nowIso() : null,
      started_at: started
        ? currentAssignment?.started_at ?? nowIso()
        : currentAssignment?.started_at ?? null,
      progress_percentage: progress,
    },
  });
};
