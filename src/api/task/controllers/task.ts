
import { factories } from '@strapi/strapi';

type RelationReference = number | string | { id?: number | string; documentId?: string } | null;

type RelationListReference =
  | RelationReference[]
  | {
      connect?: RelationReference[];
      set?: RelationReference[];
    }
  | null
  | undefined;

type RequestBody = {
  data?: Record<string, unknown>;
};

type QueryWhere = {
  id?: number;
  documentId?: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toWhere = (value: RelationReference): QueryWhere | null => {
  if (typeof value === 'number') {
    return { id: value };
  }

  if (typeof value === 'string') {
    return /^\d+$/.test(value) ? { id: Number(value) } : { documentId: value };
  }

  if (isPlainObject(value)) {
    if (typeof value.id === 'number') {
      return { id: value.id };
    }

    if (typeof value.id === 'string' && /^\d+$/.test(value.id)) {
      return { id: Number(value.id) };
    }

    if (typeof value.documentId === 'string' && value.documentId.length > 0) {
      return { documentId: value.documentId };
    }
  }

  return null;
};

const extractRelationList = (value: RelationListReference): QueryWhere[] => {
  if (!value) {
    return [];
  }

  const rawList = Array.isArray(value) ? value : value.set ?? value.connect ?? [];

  return rawList
    .map(toWhere)
    .filter((item): item is QueryWhere => item !== null);
};

const findEntity = async <T>(
  uid: string,
  reference: RelationReference,
  populate?: string[]
): Promise<T | null> => {
  const where = toWhere(reference);

  if (!where) {
    return null;
  }

  return (await strapi.db.query(uid).findOne({
    where,
    populate,
  })) as T | null;
};

export default factories.createCoreController('api::task.task', () => ({
  async create(ctx) {
    const validationError = await validateTaskDependencies(ctx.request.body as RequestBody);

    if (validationError) {
      return ctx.badRequest(validationError);
    }

    return super.create(ctx);
  },

  async update(ctx) {
    const currentTask = await findEntity<{
      id: number;
      order_index: number;
      track?: { id: number } | null;
    }>('api::task.task', ctx.params.id as string, ['track']);

    if (!currentTask) {
      return ctx.notFound('Tarefa nao encontrada');
    }

    const validationError = await validateTaskDependencies(
      ctx.request.body as RequestBody,
      currentTask
    );

    if (validationError) {
      return ctx.badRequest(validationError);
    }

    return super.update(ctx);
  },
}));

const validateTaskDependencies = async (
  body: RequestBody,
  currentTask?: {
    id: number;
    order_index: number;
    track?: { id: number } | null;
  }
) => {
  const data = body.data ?? {};
  const dependencyReferences = extractRelationList(data.depends_on as RelationListReference);

  if (dependencyReferences.length === 0) {
    return null;
  }

  const trackReference = (data.track as RelationReference) ?? currentTask?.track?.id ?? null;
  const track = await findEntity<{ id: number }>('api::track.track', trackReference);

  if (!track) {
    return 'A tarefa precisa estar vinculada a uma trilha valida para definir dependencias';
  }

  const orderIndex =
    typeof data.order_index === 'number' ? data.order_index : currentTask?.order_index ?? null;

  if (orderIndex === null) {
    return 'Informe a ordem da tarefa antes de definir dependencias';
  }

  const currentTaskId = currentTask?.id ?? null;

  for (const dependencyReference of dependencyReferences) {
    const dependencyTask = await strapi.db.query('api::task.task').findOne({
      where: dependencyReference,
      populate: ['track'],
    });

    if (!dependencyTask) {
      return 'Uma das tarefas de dependencia nao foi encontrada';
    }

    if (currentTaskId !== null && dependencyTask.id === currentTaskId) {
      return 'Tarefa nao pode depender dela mesma';
    }

    if (dependencyTask.track?.id !== track.id) {
      return 'Dependencias devem pertencer a mesma trilha da tarefa';
    }

    if (dependencyTask.order_index >= orderIndex) {
      return 'Dependencias devem possuir ordem anterior a tarefa atual';
    }
  }

  return null;
};
