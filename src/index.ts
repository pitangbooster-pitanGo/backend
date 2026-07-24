import type { Core } from '@strapi/strapi';

import { seedUsersPermissions } from './bootstrap/users-permissions';
import { backfillTrackVersions } from './bootstrap/track-versions';

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await seedUsersPermissions(strapi);
    await backfillTrackVersions(strapi);
  },
};
