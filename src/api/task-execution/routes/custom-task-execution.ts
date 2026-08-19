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
    {
      method: 'POST',
      path: '/task-executions/:id/evidences',
      handler: 'task-execution.attachEvidence',
      config: {
        auth: {},
        policies: [activeUserPolicy],
      },
    },
    {
      method: 'POST',
      path: '/task-executions/:id/approve',
      handler: 'task-execution.approve',
      config: {
        auth: {},
        policies: [
          activeUserPolicy,
          {
            name: 'global::has-role',
            config: { roles: ['admin', 'hr', 'leadership'] },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/task-executions/:id/reject',
      handler: 'task-execution.reject',
      config: {
        auth: {},
        policies: [
          activeUserPolicy,
          {
            name: 'global::has-role',
            config: { roles: ['admin', 'hr', 'leadership'] },
          },
        ],
      },
    },
    {
      method: 'POST',
      path: '/my-task-executions/:executionDocumentId/evidences',
      handler: 'task-execution.attachEvidence',
      config: {
        auth: {},
        policies: [activeUserPolicy],
      },
    },
    {
      method: 'DELETE',
      path: '/my-task-executions/:executionDocumentId/evidences/:evidenceDocumentId',
      handler: 'task-execution.removeEvidence',
      config: {
        auth: {},
        policies: [activeUserPolicy],
      },
    },
  ],
};
