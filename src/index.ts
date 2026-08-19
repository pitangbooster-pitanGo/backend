import type { Core } from '@strapi/strapi';

import { seedUsersPermissions } from './bootstrap/users-permissions';
import { backfillTrackVersions } from './bootstrap/track-versions';
import { protectHistoricalMaterialFiles } from './bootstrap/material-file-retention';

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    protectHistoricalMaterialFiles(strapi);
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    if (process.env.SKIP_APP_BOOTSTRAP === 'true') {
      return;
    }
    await seedUsersPermissions(strapi);
    await backfillTrackVersions(strapi);
  },
};
