export default {
  routes: [
    {
      method: 'GET',
      path: '/me',
      handler: 'me.meWithRole',
      config: {
        prefix: '',
        auth: {},
        policies: ['global::is-active-user'],
      },
    },
  ],
};
