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

// find/findOne/update/delete são filtrados pelo escopo no controller
// (404 fora dele — ver manager-scope.ts); create tem checagem própria no
// service, feita sobre a trilha do payload.
export default factories.createCoreRouter('api::track-assignment.track-assignment', {
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
