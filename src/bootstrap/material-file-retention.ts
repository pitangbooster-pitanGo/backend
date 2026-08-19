import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const { ValidationError } = errors;

type UploadFileReference = {
  id?: number | null;
  documentId?: string | null;
  provider?: string | null;
  hash?: string | null;
  url?: string | null;
};

const sameFile = (snapshotFile: UploadFileReference, file: UploadFileReference) => {
  if (snapshotFile.id && file.id && snapshotFile.id === file.id) {
    return true;
  }

  if (
    snapshotFile.documentId &&
    file.documentId &&
    snapshotFile.documentId === file.documentId
  ) {
    return true;
  }

  return Boolean(
    snapshotFile.hash &&
      file.hash &&
      snapshotFile.hash === file.hash &&
      (snapshotFile.provider ?? null) === (file.provider ?? null)
  );
};

const taskSnapshotReferencesFile = (taskSnapshot: any, file: UploadFileReference) =>
  Array.isArray(taskSnapshot?.materials) &&
  taskSnapshot.materials.some(
    (material: any) => material?.file && sameFile(material.file, file)
  );

const trackSnapshotReferencesFile = (trackSnapshot: any, file: UploadFileReference) =>
  Array.isArray(trackSnapshot?.tasks) &&
  trackSnapshot.tasks.some((task: any) => taskSnapshotReferencesFile(task, file));

const findHistoricalReference = async (strapi: Core.Strapi, file: UploadFileReference) => {
  const versions = await strapi.db.query('api::track-version.track-version').findMany({});
  const version = versions.find((item: any) =>
    trackSnapshotReferencesFile(item.content, file)
  );

  if (version) {
    return { source: 'track-version', id: version.id };
  }

  const assignments = await strapi.db
    .query('api::track-assignment.track-assignment')
    .findMany({});
  const assignment = assignments.find((item: any) =>
    trackSnapshotReferencesFile(item.track_snapshot, file)
  );

  if (assignment) {
    return { source: 'track-assignment', id: assignment.id };
  }

  const executions = await strapi.db
    .query('api::task-execution.task-execution')
    .findMany({});
  const execution = executions.find((item: any) =>
    taskSnapshotReferencesFile(item.task_snapshot, file)
  );

  return execution ? { source: 'task-execution', id: execution.id } : null;
};

export const protectHistoricalMaterialFiles = (strapi: Core.Strapi) => {
  const uploadService = strapi.plugin('upload').service('upload') as {
    remove(file: UploadFileReference): Promise<unknown>;
  };
  const originalRemove = uploadService.remove.bind(uploadService);

  uploadService.remove = async (file: UploadFileReference) => {
    const reference = await findHistoricalReference(strapi, file);

    if (reference) {
      throw new ValidationError(
        'Arquivo preservado por um snapshot historico nao pode ser removido',
        {
          code: 'HISTORICAL_MATERIAL_FILE_DELETE_BLOCKED',
          fileId: file.id ?? null,
          fileDocumentId: file.documentId ?? null,
          reference,
        }
      );
    }

    return originalRemove(file);
  };
};
