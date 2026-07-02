/**
 * task-evidence service
 */

import { factories } from '@strapi/strapi';
import type { UID } from '@strapi/types';

const uid = 'api::task-evidence.task-evidence' as UID.ContentType;

export default factories.createCoreService(uid);
