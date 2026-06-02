export type RelationReference = number | string | { id?: number | string; documentId?: string } | null;

export type RelationListReference =
  | RelationReference[]
  | {
      connect?: RelationReference[];
      set?: RelationReference[];
    }
  | null
  | undefined;

export type QueryWhere = {
  id?: number;
  documentId?: string;
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const toWhere = (value: RelationReference): QueryWhere | null => {
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

export const extractRelationList = (value: RelationListReference): QueryWhere[] => {
  if (!value) {
    return [];
  }

  const rawList = Array.isArray(value) ? value : value.set ?? value.connect ?? [];

  return rawList
    .map(toWhere)
    .filter((item): item is QueryWhere => item !== null);
};

export const findEntity = async <T>(
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
