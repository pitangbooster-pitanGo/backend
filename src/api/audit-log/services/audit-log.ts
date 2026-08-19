import { factories } from '@strapi/strapi';
import type { UID } from '@strapi/types';

export default factories.createCoreService(
  'api::audit-log.audit-log' as UID.ContentType
);
