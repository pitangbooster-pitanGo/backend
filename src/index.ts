import type { Core } from '@strapi/strapi';

import { seedUsersPermissions } from './bootstrap/users-permissions';
import { backfillTrackVersions } from './bootstrap/track-versions';
import { protectHistoricalMaterialFiles } from './bootstrap/material-file-retention';

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    protectHistoricalMaterialFiles(strapi);
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await seedUsersPermissions(strapi);
    await backfillTrackVersions(strapi);
  },
};
