/**
 * task-evidence router
 */

import { factories } from '@strapi/strapi';
import type { UID } from '@strapi/types';

const activeUserPolicy = 'global::is-active-user';
const uid = 'api::task-evidence.task-evidence' as UID.ContentType;

export default factories.createCoreRouter(uid, {
  only: ['find', 'findOne'],
  config: {
    find: {
      policies: [activeUserPolicy],
    },
    findOne: {
      policies: [activeUserPolicy],
    },
  },
});
