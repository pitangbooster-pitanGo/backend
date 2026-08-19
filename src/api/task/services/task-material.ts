import { errors } from '@strapi/utils';

import { isPlainObject, toWhere } from '../../../utils/relation-reference';

const { ValidationError } = errors;

const MATERIAL_TYPES = new Set(['link', 'pdf', 'document', 'video', 'file']);
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

const MIME_BY_TYPE: Record<string, Set<string>> = {
  pdf: new Set(['application/pdf']),
  document: new Set([
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ]),
  video: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
};

type MaterialInput = {
  title?: unknown;
  description?: unknown;
  material_type?: unknown;
  order_index?: unknown;
  external_url?: unknown;
  file?: unknown;
};

type UploadFile = {
  id: number;
  documentId?: string | null;
  name?: string | null;
  mime?: string | null;
  size?: number | string | null;
};

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};

const relationReference = (value: unknown) => {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  if (!isPlainObject(value)) {
    return null;
  }

  if (value.id !== undefined || value.documentId !== undefined) {
    return value;
  }

  const candidates = Array.isArray(value.set)
    ? value.set
    : Array.isArray(value.connect)
      ? value.connect
      : [];

  return candidates[0] ?? null;
};

const loadUploadFile = async (value: unknown): Promise<UploadFile | null> => {
  const where = toWhere(relationReference(value));

  if (!where) {
    return null;
  }

  return (await strapi.db.query('plugin::upload.file').findOne({ where })) as UploadFile | null;
};

const validateFile = async (material: MaterialInput, index: number, type: string) => {
  const file = await loadUploadFile(material.file);

  if (!file) {
    throw new ValidationError('Material de arquivo exige um arquivo valido', {
      code: 'TASK_MATERIAL_FILE_REQUIRED',
      materialIndex: index,
      materialType: type,
    });
  }

  const sizeBytes = Number(file.size ?? 0) * 1024;

  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new ValidationError('Arquivo de material excede o tamanho maximo de 200 MB', {
      code: 'TASK_MATERIAL_FILE_TOO_LARGE',
      materialIndex: index,
      fileId: file.id,
      maxSizeBytes: MAX_FILE_SIZE_BYTES,
    });
  }

  const mime = (file.mime ?? '').toLowerCase();
  const allowedMimes = MIME_BY_TYPE[type];

  if (allowedMimes && !allowedMimes.has(mime)) {
    throw new ValidationError('O tipo do arquivo nao corresponde ao material informado', {
      code: 'TASK_MATERIAL_FILE_TYPE_MISMATCH',
      materialIndex: index,
      materialType: type,
      mime,
    });
  }
};

export const validateTaskMaterials = async (data: Record<string, unknown>) => {
  if (!Object.prototype.hasOwnProperty.call(data, 'materials')) {
    return;
  }

  const materials = data.materials;

  if (materials === null) {
    return;
  }

  if (!Array.isArray(materials)) {
    throw new ValidationError('A lista de materiais e invalida', {
      code: 'TASK_MATERIALS_INVALID',
    });
  }

  const orderIndexes = new Set<number>();

  for (const [index, rawMaterial] of materials.entries()) {
    if (!isPlainObject(rawMaterial)) {
      throw new ValidationError('Material invalido', {
        code: 'TASK_MATERIAL_INVALID',
        materialIndex: index,
      });
    }

    const material = rawMaterial as MaterialInput;
    const title = typeof material.title === 'string' ? material.title.trim() : '';
    const type =
      typeof material.material_type === 'string' ? material.material_type.trim() : '';
    const orderIndex = Number(material.order_index);
    const externalUrl =
      typeof material.external_url === 'string' ? material.external_url.trim() : '';
    const hasFile = relationReference(material.file) !== null;

    if (!title) {
      throw new ValidationError('Titulo do material e obrigatorio', {
        code: 'TASK_MATERIAL_TITLE_REQUIRED',
        materialIndex: index,
      });
    }

    if (!MATERIAL_TYPES.has(type)) {
      throw new ValidationError('Tipo de material invalido', {
        code: 'TASK_MATERIAL_TYPE_INVALID',
        materialIndex: index,
        materialType: type,
      });
    }

    if (!Number.isInteger(orderIndex) || orderIndex < 0) {
      throw new ValidationError('Ordem do material deve ser um inteiro nao negativo', {
        code: 'TASK_MATERIAL_ORDER_INVALID',
        materialIndex: index,
        orderIndex: material.order_index,
      });
    }

    if (orderIndexes.has(orderIndex)) {
      throw new ValidationError('A ordem dos materiais nao pode se repetir', {
        code: 'TASK_MATERIAL_ORDER_DUPLICATED',
        materialIndex: index,
        orderIndex,
      });
    }

    orderIndexes.add(orderIndex);

    if (type === 'link') {
      if (!isHttpUrl(externalUrl)) {
        throw new ValidationError('Material de link exige URL HTTP ou HTTPS', {
          code: 'TASK_MATERIAL_URL_REQUIRED',
          materialIndex: index,
        });
      }

      if (hasFile) {
        throw new ValidationError('Material de link nao aceita arquivo', {
          code: 'TASK_MATERIAL_LINK_FILE_NOT_ALLOWED',
          materialIndex: index,
        });
      }

      continue;
    }

    if (externalUrl) {
      throw new ValidationError('Material de arquivo nao aceita URL externa', {
        code: 'TASK_MATERIAL_FILE_URL_NOT_ALLOWED',
        materialIndex: index,
      });
    }

    await validateFile(material, index, type);
  }
};
