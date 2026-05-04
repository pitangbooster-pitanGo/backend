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

export default factories.createCoreRouter('api::task-execution.task-execution', {
  config: {
    find: {
      policies: managementPolicies,
    },
    findOne: {
      policies: managementPolicies,
    },
    create: {
      policies: managementPolicies,
    },
    update: {
      policies: managementPolicies,
    },
    delete: {
      policies: managementPolicies,
    },
  },
});
