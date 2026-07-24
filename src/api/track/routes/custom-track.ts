export default {
  routes: [
    {
      method: 'GET',
      path: '/tracks/:id/details',
      handler: 'track.details',
      config: {
        auth: {},
        policies: ['global::is-active-user'],
      },
    },
  ],
};
