const activeUserPolicy = 'global::is-active-user';

export default {
  routes: [
    {
      method: 'GET',
      path: '/my-track-assignments',
      handler: 'track-assignment.myAssignments',
      config: {
        auth: {},
        policies: [activeUserPolicy],
      },
    },
  ],
};
