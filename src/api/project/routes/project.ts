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

export default factories.createCoreRouter('api::project.project', {
  config: {
    // is-active-user (não has-role): colaborador também pode listar
    // projetos. O recorte por perfil (quem vê o quê) é feito no controller
    // (find/findOne sobrescritos), não numa policy — ver manager-scope.ts.
    find: {
      policies: [activeUserPolicy],
    },
    findOne: {
      policies: [activeUserPolicy],
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
