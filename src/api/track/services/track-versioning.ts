import { errors } from '@strapi/utils';

import { toWhere, type RelationReference } from '../../../utils/relation-reference';

const { NotFoundError, ValidationError } = errors;

export type TaskSnapshot = {
  sourceDocumentId: string;
  title: string;
  description: string | null;
  orderIndex: number;
  actionType: string | null;
  externalLink: string | null;
  isRequired: boolean;
  isActive: boolean;
  requiresEvidence: boolean;
  requiresManualApproval: boolean;
  dependsOn: string[];
};

export type TrackSnapshot = {
  sourceDocumentId: string;
  version: number;
  name: string;
  description: string | null;
  trackType: string | null;
  isActive: boolean;
  tasks: TaskSnapshot[];
};

type TrackEntity = {
  id: number;
  documentId?: string | null;
  version?: number | null;
  name: string;
  description?: string | null;
  track_type?: string | null;
  is_active?: boolean | null;
  tasks?: Array<{
    id: number;
    documentId?: string | null;
    publishedAt?: string | null;
    title: string;
    description?: string | null;
    order_index: number;
    action_type?: string | null;
    external_link?: string | null;
    is_required?: boolean | null;
    is_active?: boolean | null;
    requires_evidence?: boolean | null;
    requires_manual_approval?: boolean | null;
    depends_on?: Array<{ id: number; documentId?: string | null }> | null;
  }> | null;
};

const sourceId = (entity: { id: number; documentId?: string | null }) =>
  entity.documentId ?? String(entity.id);

const loadTrack = async (reference: RelationReference): Promise<TrackEntity> => {
  const where = toWhere(reference);

  if (!where) {
    throw new ValidationError('Identificador de trilha invalido', {
      code: 'TRACK_REFERENCE_INVALID',
    });
  }

  const track = (await strapi.db.query('api::track.track').findOne({
    where,
  })) as TrackEntity | null;

  if (!track) {
    throw new NotFoundError('Trilha nao encontrada', {
      code: 'TRACK_NOT_FOUND',
      reference,
    });
  }

  const tasks = (await strapi.db.query('api::task.task').findMany({
    where: {
      track: track.documentId
        ? { documentId: track.documentId }
        : { id: track.id },
    },
    populate: ['depends_on'],
  })) as NonNullable<TrackEntity['tasks']>;
  const tasksByDocument = new Map<string, (typeof tasks)[number]>();

  for (const task of tasks) {
    const key = sourceId(task);
    const current = tasksByDocument.get(key);

    if (!current || (!current.publishedAt && task.publishedAt)) {
      tasksByDocument.set(key, task);
    }
  }

  track.tasks = [...tasksByDocument.values()];
  return track;
};

export const buildTrackSnapshot = (track: TrackEntity, version: number): TrackSnapshot => {
  const tasks = (track.tasks ?? [])
    .filter((task) => task.is_active !== false)
    .map<TaskSnapshot>((task) => ({
      sourceDocumentId: sourceId(task),
      title: task.title,
      description: task.description ?? null,
      orderIndex: task.order_index,
      actionType: task.action_type ?? null,
      externalLink: task.external_link ?? null,
      isRequired: task.is_required === true,
      isActive: task.is_active !== false,
      requiresEvidence: task.requires_evidence === true,
      requiresManualApproval: task.requires_manual_approval === true,
      dependsOn: (task.depends_on ?? []).map(sourceId),
    }))
    .sort((left, right) => left.orderIndex - right.orderIndex);

  return {
    sourceDocumentId: sourceId(track),
    version,
    name: track.name,
    description: track.description ?? null,
    trackType: track.track_type ?? null,
    isActive: track.is_active !== false,
    tasks,
  };
};

const persistSnapshot = async (
  track: TrackEntity,
  version: number,
  createdByUserId?: number
) => {
  const content = buildTrackSnapshot(track, version);

  const existing = await strapi.db.query('api::track-version.track-version').findOne({
    where: {
      track: { id: track.id },
      version,
    },
  });

  if (existing) {
    return existing;
  }

  return strapi.db.query('api::track-version.track-version').create({
    data: {
      track: track.id,
      version,
      content,
      created_by_user: createdByUserId ?? null,
    },
  });
};

export const ensureCurrentTrackSnapshot = async (
  reference: RelationReference,
  createdByUserId?: number
) => {
  const track = await loadTrack(reference);
  const version = track.version ?? 1;
  const existing = await strapi.db.query('api::track-version.track-version').findOne({
    where: {
      track: { id: track.id },
      version,
    },
  });

  if (existing) {
    return existing as { id: number; version: number; content: TrackSnapshot };
  }

  return (await persistSnapshot(track, version, createdByUserId)) as {
    id: number;
    version: number;
    content: TrackSnapshot;
  };
};

// Used only during the one-time migration from Draft & Publish. Normal
// application flows never update an existing TrackVersion.
export const repairCurrentTrackSnapshot = async (
  reference: RelationReference,
  createdByUserId?: number
) => {
  const track = await loadTrack(reference);
  const version = track.version ?? 1;
  const content = buildTrackSnapshot(track, version);
  const existing = await strapi.db.query('api::track-version.track-version').findOne({
    where: {
      track: { id: track.id },
      version,
    },
  });

  if (!existing) {
    return persistSnapshot(track, version, createdByUserId);
  }

  const storedContent = existing.content as TrackSnapshot | null;
  const needsLegacyRepair =
    (!storedContent ||
      !Array.isArray(storedContent.tasks) ||
      storedContent.tasks.length === 0) &&
    content.tasks.length > 0;

  if (!needsLegacyRepair) {
    return existing;
  }

  await strapi.db.query('api::track-version.track-version').update({
    where: { id: existing.id },
    data: { content },
  });

  return { ...existing, content };
};

export const createNextTrackSnapshot = async (
  reference: RelationReference,
  createdByUserId?: number,
  transaction?: ((tableName: string) => any) | null
) => {
  let track = await loadTrack(reference);

  // Serializes concurrent revisions of the same track.
  const connection = transaction ?? strapi.db.connection;
  await connection('tracks').where({ id: track.id }).forUpdate().first('id');

  track = await loadTrack(track.id);
  const version = (track.version ?? 1) + 1;

  await strapi.db.query('api::track.track').update({
    where: { id: track.id },
    data: { version },
  });

  track.version = version;
  return persistSnapshot(track, version, createdByUserId);
};

export const findTrackSnapshot = async (
  reference: RelationReference,
  requestedVersion?: number
) => {
  const track = await loadTrack(reference);
  const version = requestedVersion ?? track.version ?? 1;

  const snapshot = await strapi.db.query('api::track-version.track-version').findOne({
    where: {
      track: { id: track.id },
      version,
    },
  });

  if (!snapshot) {
    throw new NotFoundError('Versao da trilha nao encontrada', {
      code: 'TRACK_VERSION_NOT_FOUND',
      trackId: track.id,
      version,
    });
  }

  return snapshot as { id: number; version: number; content: TrackSnapshot };
};
