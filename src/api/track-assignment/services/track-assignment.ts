import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';

import { findEntity, type RelationReference } from '../../../utils/relation-reference';
import {
  ensureCurrentTrackSnapshot,
  type TrackSnapshot,
} from '../../track/services/track-versioning';

const { ApplicationError, ValidationError } = errors;

type AssignmentInput = Record<string, unknown>;

type AssignTrackToUserParams = {
  data: AssignmentInput;
  assignedByUserId: number;
  query?: Record<string, unknown>;
};

type TrackEntity = {
  id: number;
  version?: number | null;
};

type UserEntity = {
  id: number;
};

export default factories.createCoreService('api::track-assignment.track-assignment', () => ({
  async assignTrackToUser({ data, assignedByUserId, query = {} }: AssignTrackToUserParams) {
    const track = await findEntity<TrackEntity>(
      'api::track.track',
      data.track as RelationReference
    );

    if (!track) {
      throw new ValidationError('Trilha informada nao foi encontrada', {
        code: 'TRACK_NOT_FOUND',
        track: data.track,
      });
    }

    const assignedUser = await findEntity<UserEntity>(
      'plugin::users-permissions.user',
      data.user as RelationReference
    );

    if (!assignedUser) {
      throw new ValidationError('Usuario informado nao foi encontrado', {
        code: 'ASSIGNED_USER_NOT_FOUND',
        user: data.user,
      });
    }

    const versionRecord = (await ensureCurrentTrackSnapshot(track.id, assignedByUserId)) as {
      version: number;
      content: TrackSnapshot;
    };
    const snapshot = versionRecord.content;

    const assignment = await strapi.service('api::track-assignment.track-assignment').create({
      ...query,
      data: {
        ...data,
        track: track.id,
        user: assignedUser.id,
        assigned_by: assignedByUserId,
        status: 'not_started',
        progress_percentage: 0,
        started_at: null,
        completed_at: null,
        track_version: versionRecord.version,
        track_name: snapshot.name,
        track_description: snapshot.description,
        track_snapshot: snapshot,
      },
      populate: ['track'],
    });

    if (!assignment?.id) {
      throw new ApplicationError('Atribuicao criada sem identificador', {
        code: 'TRACK_ASSIGNMENT_ID_MISSING',
        assignedByUserId,
      });
    }

    await strapi
      .service('api::task-execution.task-execution')
      .createExecutionsForAssignment(assignment);
    await strapi
      .service('api::task-execution.task-execution')
      .syncTrackAssignmentProgress(assignment.id);

    return strapi.db.query('api::track-assignment.track-assignment').findOne({
      where: { id: assignment.id },
      populate: ['track'],
    });
  },
}));
