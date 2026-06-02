import { errors } from '@strapi/utils';

import {
  extractRelationList,
  findEntity,
  type RelationListReference,
  type RelationReference,
} from '../../../utils/relation-reference';

const { ValidationError } = errors;

type RequestBody = {
  data?: Record<string, unknown>;
};

type CurrentTask = {
  id: number;
  order_index: number;
  track?: { id: number } | null;
};

export const validateTaskDependencies = async (
  body: RequestBody,
  currentTask?: CurrentTask
) => {
  const data = body.data ?? {};
  const dependencyReferences = extractRelationList(data.depends_on as RelationListReference);

  if (dependencyReferences.length === 0) {
    return null;
  }

  const trackReference = (data.track as RelationReference) ?? currentTask?.track?.id ?? null;
  const track = await findEntity<{ id: number }>('api::track.track', trackReference);

  if (!track) {
    throw new ValidationError('A tarefa precisa estar vinculada a uma trilha valida', {
      code: 'TASK_TRACK_REQUIRED_FOR_DEPENDENCIES',
      track: trackReference,
    });
  }

  const orderIndex =
    typeof data.order_index === 'number' ? data.order_index : currentTask?.order_index ?? null;

  if (orderIndex === null) {
    throw new ValidationError('Informe a ordem da tarefa antes de definir dependencias', {
      code: 'TASK_ORDER_REQUIRED_FOR_DEPENDENCIES',
      taskId: currentTask?.id,
    });
  }

  const currentTaskId = currentTask?.id ?? null;

  for (const dependencyReference of dependencyReferences) {
    const dependencyTask = await strapi.db.query('api::task.task').findOne({
      where: dependencyReference,
      populate: ['track'],
    });

    if (!dependencyTask) {
      throw new ValidationError('Uma das tarefas de dependencia nao foi encontrada', {
        code: 'TASK_DEPENDENCY_NOT_FOUND',
        dependency: dependencyReference,
      });
    }

    if (currentTaskId !== null && dependencyTask.id === currentTaskId) {
      throw new ValidationError('Tarefa nao pode depender dela mesma', {
        code: 'TASK_DEPENDS_ON_ITSELF',
        taskId: currentTaskId,
      });
    }

    if (dependencyTask.track?.id !== track.id) {
      throw new ValidationError('Dependencias devem pertencer a mesma trilha da tarefa', {
        code: 'TASK_DEPENDENCY_TRACK_MISMATCH',
        taskTrackId: track.id,
        dependencyTaskId: dependencyTask.id,
        dependencyTrackId: dependencyTask.track?.id,
      });
    }

    if (dependencyTask.order_index >= orderIndex) {
      throw new ValidationError('Dependencias devem possuir ordem anterior a tarefa atual', {
        code: 'TASK_DEPENDENCY_ORDER_INVALID',
        taskId: currentTaskId,
        orderIndex,
        dependencyTaskId: dependencyTask.id,
        dependencyOrderIndex: dependencyTask.order_index,
      });
    }
  }

  return null;
};
