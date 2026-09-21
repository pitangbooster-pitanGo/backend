const managementPolicies = [
  'global::is-active-user',
  {
    name: 'global::has-role',
    config: {
      roles: ['admin', 'hr', 'leadership'],
    },
  },
];

// Ações de revisão humana. Só elas podem tirar uma sugestão de `pending_review`.
export default {
  routes: [
    {
      method: 'POST',
      path: '/ai-suggestions/:id/approve',
      handler: 'ai-suggestion.approve',
      config: { policies: managementPolicies },
    },
    {
      method: 'POST',
      path: '/ai-suggestions/:id/reject',
      handler: 'ai-suggestion.reject',
      config: { policies: managementPolicies },
    },
  ],
};
