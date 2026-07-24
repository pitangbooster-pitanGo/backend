import { factories } from '@strapi/strapi';
import type { UID } from '@strapi/types';

export default factories.createCoreController(
  'api::track-version.track-version' as UID.ContentType
);
