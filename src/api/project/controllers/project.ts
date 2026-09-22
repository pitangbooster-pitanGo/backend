/**
 * project controller
 */

import { factories } from '@strapi/strapi';

import { getScopeForUser, mergeScopeIntoQuery } from '../../../utils/manager-scope';

const UID = 'api::project.project';

export default factories.createCoreController(UID, () => ({
  // find/findOne sobrescritos só para aplicar o escopo por perfil (ver
  // manager-scope.ts): admin/hr veem tudo; leadership só os projetos onde é
  // manager; employee só os projetos das trilhas às quais tem atribuição.
  async find(ctx) {
    const authUser = ctx.state.user;
    if (!authUser) {
      return ctx.unauthorized('Autenticação obrigatória', { code: 'AUTH_REQUIRED' });
    }

    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const scope = await getScopeForUser(authUser.id);
    const query = mergeScopeIntoQuery(sanitizedQuery, scope, 'project');

    const { results, pagination } = await strapi.service(UID).find(query);
    const sanitizedResults = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedResults, { pagination });
  },

  async findOne(ctx) {
    const authUser = ctx.state.user;
    if (!authUser) {
      return ctx.unauthorized('Autenticação obrigatória', { code: 'AUTH_REQUIRED' });
    }

    const { id } = ctx.params;
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const scope = await getScopeForUser(authUser.id);
    const query = mergeScopeIntoQuery(sanitizedQuery, scope, 'project');

    const entity = await strapi.service(UID).findOne(id, query);
    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },
}));
