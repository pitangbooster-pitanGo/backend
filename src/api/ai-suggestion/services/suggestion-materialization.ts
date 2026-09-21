import type { UID } from '@strapi/types';

import { recordAuditLog } from '../../../utils/audit-log';
import { ensureCurrentTrackSnapshot } from '../../track/services/track-versioning';
import type { SuggestedStructure } from './ai-types';

type CreatedRow = { id: number; documentId?: string | null; name?: string; [key: string]: unknown };

/**
 * Cria de verdade a trilha e as tarefas de uma sugestão JÁ APROVADA por uma
 * pessoa. Deve rodar dentro de `strapi.db.transaction` (o controller garante):
 * qualquer falha desfaz tudo e a sugestão volta a `pending_review`.
 *
 * Diferença deliberada do fluxo manual: aqui a trilha nasce na versão 1 com
 * todas as tarefas já dentro do snapshot, em vez de uma versão por tarefa criada.
 */
export const materializeSuggestion = async (
  structure: SuggestedStructure,
  reviewerId: number
): Promise<{ track: CreatedRow; tasks: CreatedRow[] }> => {
  const track = (await strapi.db.query('api::track.track' as UID.ContentType).create({
    data: {
      name: structure.track.name,
      description: structure.track.description,
      track_type: structure.track.track_type,
      is_active: true,
      version: 1,
      created_by_user: reviewerId,
    },
  })) as CreatedRow;

  // `depends_on` na sugestão são POSIÇÕES; aqui viram ids das tarefas já criadas
  // (o validador garante que sempre apontam para tarefas anteriores).
  const idByPosition = new Map<number, number>();
  const tasks: CreatedRow[] = [];

  for (const suggested of structure.tasks) {
    const task = (await strapi.db.query('api::task.task' as UID.ContentType).create({
      data: {
        title: suggested.title,
        description: suggested.description,
        order_index: suggested.order_index,
        action_type: suggested.action_type,
        requires_evidence: suggested.requires_evidence,
        requires_manual_approval: suggested.requires_manual_approval,
        is_active: true,
        track: track.id,
        depends_on: suggested.depends_on.map((position) => idByPosition.get(position) as number),
      },
    })) as CreatedRow;

    idByPosition.set(suggested.order_index, task.id);
    tasks.push(task);
  }

  await ensureCurrentTrackSnapshot(track.id, reviewerId);

  await recordAuditLog({
    entityType: 'track',
    entityId: track.documentId,
    action: 'create',
    actorId: reviewerId,
    after: track,
  });
  for (const task of tasks) {
    await recordAuditLog({
      entityType: 'task',
      entityId: task.documentId,
      action: 'create',
      actorId: reviewerId,
      after: task,
    });
  }

  return { track, tasks };
};
