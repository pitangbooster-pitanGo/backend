const activeUserPolicy = 'global::is-active-user';

export default {
  routes: [
    {
      method: 'GET',
      path: '/my-track-assignments/:id/tasks',
      handler: 'task-execution.listForMyAssignment',
      config: {
        auth: {},
        policies: [activeUserPolicy],
      },
    },
    {
      method: 'POST',
      path: '/task-executions/:id/complete',
      handler: 'task-execution.complete',
      config: {
        auth: {},
        policies: [activeUserPolicy],
      },
    },
  ],
};
