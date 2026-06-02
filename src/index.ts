import type { Core } from '@strapi/strapi';

import { seedUsersPermissions } from './bootstrap/users-permissions';

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await seedUsersPermissions(strapi);
  },
};
