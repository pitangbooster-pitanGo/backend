/**
 * task-evidence router
 */

import { factories } from '@strapi/strapi';
import type { UID } from '@strapi/types';

const activeUserPolicy = 'global::is-active-user';
const managementPolicy = {
  name: 'global::has-role',
  config: {
    roles: ['admin', 'hr', 'leadership'],
  },
};
const uid = 'api::task-evidence.task-evidence' as UID.ContentType;

export default factories.createCoreRouter(uid, {
  only: ['find', 'findOne'],
  config: {
    find: {
      policies: [activeUserPolicy, managementPolicy],
    },
    findOne: {
      policies: [activeUserPolicy, managementPolicy],
    },
  },
});
