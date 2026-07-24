import type { Core } from '@strapi/strapi';

import {
  ensureCurrentTrackSnapshot,
  repairCurrentTrackSnapshot,
  type TaskSnapshot,
  type TrackSnapshot,
} from '../api/track/services/track-versioning';

type Assignment = {
  id: number;
  track_version?: number | null;
  track_snapshot?: TrackSnapshot | null;
  track?: { id: number } | null;
};

const legacyTaskSnapshot = (task: any): TaskSnapshot => ({
  sourceDocumentId: task.documentId ?? String(task.id),
  title: task.title ?? '',
  description: task.description ?? null,
  orderIndex: task.order_index ?? 0,
  actionType: task.action_type ?? null,
  externalLink: task.external_link ?? null,
  isRequired: task.is_required === true,
  isActive: task.is_active !== false,
  requiresEvidence: task.requires_evidence === true,
  requiresManualApproval: task.requires_manual_approval === true,
  dependsOn: (task.depends_on ?? []).map(
    (dependency: any) => dependency.documentId ?? String(dependency.id)
  ),
});

export const backfillTrackVersions = async (strapi: Core.Strapi) => {
  const tracks = await strapi.db.query('api::track.track').findMany({});

  for (const track of tracks) {
    await repairCurrentTrackSnapshot(track.id);
  }

  const assignments = (await strapi.db.query('api::track-assignment.track-assignment').findMany({
    populate: ['track'],
  })) as Assignment[];

  for (const assignment of assignments) {
    if (!assignment.track?.id || assignment.track_snapshot) {
      continue;
    }

    const currentVersion = (await ensureCurrentTrackSnapshot(assignment.track.id)) as {
      version: number;
      content: TrackSnapshot;
    };

    if (
      assignment.track_version &&
      assignment.track_version !== currentVersion.version
    ) {
      strapi.log.warn(
        `[TrackVersion.backfill] A atribuicao ${assignment.id} referenciava a versao ` +
          `${assignment.track_version}, sem snapshot historico. Foi congelado o conteudo atual.`
      );
    }

    await strapi.db.query('api::track-assignment.track-assignment').update({
      where: { id: assignment.id },
      data: {
        track_version: currentVersion.version,
        track_name: currentVersion.content.name,
        track_description: currentVersion.content.description,
        track_snapshot: currentVersion.content,
      },
    });
  }

  const executions = await strapi.db.query('api::task-execution.task-execution').findMany({
    populate: {
      track_assignment: true,
      task: {
        populate: ['depends_on'],
      },
    },
  });

  for (const execution of executions as any[]) {
    if (execution.task_snapshot) {
      continue;
    }

    const assignment = assignments.find(
      (candidate) => candidate.id === execution.track_assignment?.id
    );
    const liveAssignment = assignment?.track?.id
      ? await strapi.db.query('api::track-assignment.track-assignment').findOne({
          where: { id: assignment.id },
        })
      : null;
    const assignmentSnapshot = liveAssignment?.track_snapshot as TrackSnapshot | null;
    const taskSourceId = execution.task?.documentId ?? String(execution.task?.id ?? '');
    const taskSnapshot =
      assignmentSnapshot?.tasks.find((task) => task.sourceDocumentId === taskSourceId) ??
      (execution.task ? legacyTaskSnapshot(execution.task) : null);

    if (!taskSnapshot) {
      strapi.log.warn(
        `[TrackVersion.backfill] Execucao ${execution.id} sem tarefa nao pode ser congelada.`
      );
      continue;
    }

    await strapi.db.query('api::task-execution.task-execution').update({
      where: { id: execution.id },
      data: {
        task_source_document_id: taskSnapshot.sourceDocumentId,
        task_snapshot: taskSnapshot,
      },
    });
  }

  for (const assignment of assignments) {
    const liveAssignment = await strapi.db
      .query('api::track-assignment.track-assignment')
      .findOne({
        where: { id: assignment.id },
      });
    const currentSnapshot = liveAssignment?.track_snapshot as TrackSnapshot | null;

    if (!currentSnapshot || currentSnapshot.tasks.length > 0) {
      continue;
    }

    const assignmentExecutions = await strapi.db
      .query('api::task-execution.task-execution')
      .findMany({
        where: {
          track_assignment: { id: assignment.id },
        },
      });
    const frozenTasks = (assignmentExecutions as any[])
      .map((execution) => execution.task_snapshot as TaskSnapshot | null)
      .filter((task): task is TaskSnapshot => task !== null)
      .sort((left, right) => left.orderIndex - right.orderIndex);

    if (frozenTasks.length === 0) {
      continue;
    }

    await strapi.db.query('api::track-assignment.track-assignment').update({
      where: { id: assignment.id },
      data: {
        track_snapshot: {
          ...currentSnapshot,
          tasks: frozenTasks,
        },
      },
    });
  }
};
