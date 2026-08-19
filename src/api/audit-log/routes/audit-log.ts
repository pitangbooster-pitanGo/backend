import { factories } from '@strapi/strapi';

const managementRoles = ['admin', 'hr', 'leadership'];

const activeUserPolicy = 'global::is-active-user';

const managementPolicies = [
  activeUserPolicy,
  {
    name: 'global::has-role',
    config: {
      roles: managementRoles,
    },
  },
];

// Audit logs are written internally (see src/utils/audit-log.ts) and are
// read-only from the API — only find/findOne are exposed.
export default factories.createCoreRouter('api::audit-log.audit-log', {
  only: ['find', 'findOne'],
  config: {
    find: {
      policies: managementPolicies,
    },
    findOne: {
      policies: managementPolicies,
    },
  },
});
