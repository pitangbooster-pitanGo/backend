import type { UID } from '@strapi/types';

export type AuditEntityType = 'task' | 'track' | 'track-assignment';
export type AuditAction = 'create' | 'update' | 'delete';

type AuditableEntity = Record<string, unknown> | null | undefined;

const IGNORED_FIELDS = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'locale',
  // large, effectively-immutable snapshot payload — not useful in a field diff
  'track_snapshot',
]);

// Relations come back populated as objects/arrays of objects; reduce them to
// their id(s) so the diff compares identity rather than full nested payloads.
const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .map(normalize)
      .sort((left, right) => String(left).localeCompare(String(right)));
  }

  if (value && typeof value === 'object') {
    if ('id' in (value as Record<string, unknown>)) {
      return (value as { id: unknown }).id;
    }
    return value;
  }

  return value ?? null;
};

const diffFields = (
  before: AuditableEntity,
  after: AuditableEntity
): Record<string, { from: unknown; to: unknown }> => {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) {
      continue;
    }

    const fromValue = normalize(before?.[key]);
    const toValue = normalize(after?.[key]);

    if (JSON.stringify(fromValue) !== JSON.stringify(toValue)) {
      changes[key] = { from: fromValue, to: toValue };
    }
  }

  return changes;
};

type RecordAuditLogParams = {
  entityType: AuditEntityType;
  entityId: string | null | undefined;
  action: AuditAction;
  actorId?: number | null;
  before?: AuditableEntity;
  after?: AuditableEntity;
};

export const recordAuditLog = async ({
  entityType,
  entityId,
  action,
  actorId,
  before,
  after,
}: RecordAuditLogParams) => {
  if (!entityId) {
    return;
  }

  const changes =
    action === 'create'
      ? diffFields(null, after)
      : action === 'delete'
        ? diffFields(before, null)
        : diffFields(before, after);

  if (action === 'update' && Object.keys(changes).length === 0) {
    return;
  }

  try {
    await strapi.db.query('api::audit-log.audit-log' as UID.ContentType).create({
      data: {
        entity_type: entityType,
        entity_id: entityId,
        action,
        actor: actorId ?? null,
        changes,
      },
    });
  } catch (error) {
    // Auditing must never break the actual mutation it's observing.
    strapi.log.error('[audit-log] Falha ao registrar evento de auditoria', {
      entityType,
      entityId,
      action,
      error,
    });
  }
};
