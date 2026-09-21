import { factories } from '@strapi/strapi';

const managementRoles = ['admin', 'hr', 'leadership'];

const managementPolicies = [
  'global::is-active-user',
  {
    name: 'global::has-role',
    config: {
      roles: managementRoles,
    },
  },
];

// Sugestões só são criadas via `create` (que chama a IA) e nunca editadas nem
// apagadas por CRUD genérico: o ciclo de vida é controlado pelas ações de
// revisão.
export default factories.createCoreRouter('api::ai-suggestion.ai-suggestion', {
  only: ['find', 'findOne', 'create'],
  config: {
    find: { policies: managementPolicies },
    findOne: { policies: managementPolicies },
    create: { policies: managementPolicies },
  },
});
