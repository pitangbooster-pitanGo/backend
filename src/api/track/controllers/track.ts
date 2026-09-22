import { factories } from '@strapi/strapi';

import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';
import { findEntity } from '../../../utils/relation-reference';
import { recordAuditLog } from '../../../utils/audit-log';
import { getScopeForRole, getScopeForUser, mergeScopeIntoQuery } from '../../../utils/manager-scope';
import {
  createNextTrackSnapshot,
  ensureCurrentTrackSnapshot,
  findTrackSnapshot,
} from '../services/track-versioning';

type TrackAuditSnapshot = {
  id: number;
  documentId?: string | null;
};

type TrackRequestBody = {
  data?: Record<string, unknown>;
};

const responseReference = (response: unknown) => {
  const data = (response as { data?: { id?: number; documentId?: string } })?.data;
  return data?.documentId ?? data?.id ?? null;
};

const UID = 'api::track.track';

export default factories.createCoreController(UID, () => ({
  // find/findOne sobrescritos só para aplicar o escopo por perfil (ver
  // manager-scope.ts): admin/hr veem tudo; leadership só trilhas
  // institucionais ou dos projetos onde é manager; employee só as trilhas
  // às quais tem atribuição.
  async find(ctx) {
    const authUser = ctx.state.user;
    if (!authUser) {
      return ctx.unauthorized('Autenticação obrigatória', { code: 'AUTH_REQUIRED' });
    }

    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const scope = await getScopeForUser(authUser.id);
    const query = mergeScopeIntoQuery(sanitizedQuery, scope, 'track');

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
    const query = mergeScopeIntoQuery(sanitizedQuery, scope, 'track');

    const entity = await strapi.service(UID).findOne(id, query);
    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  async create(ctx) {
    try {
      const authUser = ctx.state.user;

      if (!authUser) {
        return ctx.unauthorized('Autenticação obrigatória', {
          code: 'AUTH_REQUIRED',
        });
      }

      const body = (ctx.request.body ?? {}) as TrackRequestBody;
      const { version: _clientVersion, ...data } = body.data ?? {};

      await this.validateInput(data, ctx);
      const sanitizedData = (await this.sanitizeInput(data, ctx)) as Record<string, unknown>;

      ctx.request.body = {
        ...body,
        data: {
          ...sanitizedData,
          created_by_user: authUser.id,
          version: 1,
        },
      };

      return strapi.db.transaction(async () => {
        const response = await super.create(ctx);
        const reference = responseReference(response);

        if (reference) {
          await ensureCurrentTrackSnapshot(reference, authUser.id);
        }

        const createdTrack = reference
          ? await findEntity<TrackAuditSnapshot>('api::track.track', reference)
          : null;

        await recordAuditLog({
          entityType: 'track',
          entityId: createdTrack?.documentId ?? (typeof reference === 'string' ? reference : null),
          action: 'create',
          actorId: authUser.id,
          after: createdTrack,
        });

        return response;
      });
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('track.create', error, {
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao criar trilha', {
        code: 'TRACK_CREATE_FAILED',
      });
    }
  },

  async update(ctx) {
    try {
      const body = (ctx.request.body ?? {}) as TrackRequestBody;
      const authUser = ctx.state.user;

      if (!authUser) {
        return ctx.unauthorized('Autenticação obrigatória', {
          code: 'AUTH_REQUIRED',
        });
      }

      if (body.data) {
        const {
          created_by_user: _createdByUser,
          version: _clientVersion,
          ...data
        } = body.data;
        await this.validateInput(data, ctx);
        const sanitizedData = (await this.sanitizeInput(data, ctx)) as Record<string, unknown>;

        ctx.request.body = {
          ...body,
          data: sanitizedData,
        };
      }

      const beforeTrack = await findEntity<TrackAuditSnapshot>(
        'api::track.track',
        ctx.params.id as string
      );

      return strapi.db.transaction(async ({ trx }) => {
        const response = await super.update(ctx);
        const versionRecord = (await createNextTrackSnapshot(
          ctx.params.id,
          authUser.id,
          trx
        )) as { version?: number };
        const responseData = (response as { data?: Record<string, unknown> })?.data;

        if (responseData && versionRecord.version) {
          responseData.version = versionRecord.version;
        }

        const afterTrack = await findEntity<TrackAuditSnapshot>(
          'api::track.track',
          ctx.params.id as string
        );

        await recordAuditLog({
          entityType: 'track',
          entityId: beforeTrack?.documentId ?? afterTrack?.documentId ?? (ctx.params.id as string),
          action: 'update',
          actorId: authUser.id,
          before: beforeTrack,
          after: afterTrack,
        });

        return response;
      });
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('track.update', error, {
        trackId: ctx.params.id,
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao atualizar trilha', {
        code: 'TRACK_UPDATE_FAILED',
        trackId: ctx.params.id,
      });
    }
  },

  async delete(ctx) {
    try {
      const authUser = ctx.state.user;

      if (!authUser) {
        return ctx.unauthorized('Autenticação obrigatória', {
          code: 'AUTH_REQUIRED',
        });
      }

      const currentTrack = await findEntity<TrackAuditSnapshot>(
        'api::track.track',
        ctx.params.id as string
      );

      if (!currentTrack) {
        return ctx.notFound('Trilha nao encontrada', {
          code: 'TRACK_NOT_FOUND',
          trackId: ctx.params.id,
        });
      }

      return strapi.db.transaction(async () => {
        const response = await super.delete(ctx);

        await recordAuditLog({
          entityType: 'track',
          entityId: currentTrack.documentId ?? (ctx.params.id as string),
          action: 'delete',
          actorId: authUser.id,
          before: currentTrack,
        });

        return response;
      });
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('track.delete', error, {
        trackId: ctx.params.id,
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao excluir trilha', {
        code: 'TRACK_DELETE_FAILED',
        trackId: ctx.params.id,
      });
    }
  },

  async details(ctx) {
    try {
      const authUser = ctx.state.user;
      if (!authUser) {
        return ctx.unauthorized('Autenticação obrigatória', { code: 'AUTH_REQUIRED' });
      }

      // Ação customizada: não passa pelo `find`/`findOne` padrão do Strapi,
      // então a policy global::scope-by-manager (que mescla filtro em
      // ctx.query) não se aplica aqui — a checagem precisa ser explícita.
      const trackEntity = await findEntity<{ id: number }>('api::track.track', ctx.params.id);
      if (!trackEntity) {
        return ctx.notFound('Trilha nao encontrada', { code: 'TRACK_NOT_FOUND' });
      }

      const requester = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: authUser.id },
        populate: ['role'],
      });
      const scope = await getScopeForRole(authUser.id, requester?.role?.type as string | undefined);
      if (!scope.unrestricted && !scope.trackIds.includes(trackEntity.id)) {
        // 404, não 403: não confirma pra quem não tem acesso que a trilha existe.
        return ctx.notFound('Trilha nao encontrada', { code: 'TRACK_NOT_FOUND' });
      }

      const rawVersion = ctx.query.version;
      const version =
        rawVersion === undefined
          ? undefined
          : Number(Array.isArray(rawVersion) ? rawVersion[0] : rawVersion);

      if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
        return ctx.badRequest('Versao da trilha invalida', {
          code: 'TRACK_VERSION_INVALID',
          version: rawVersion,
        });
      }

      const snapshot = await findTrackSnapshot(ctx.params.id, version);
      ctx.body = {
        data: snapshot.content,
        meta: {
          version: snapshot.version,
        },
      };
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('track.details', error, {
        trackId: ctx.params.id,
        version: ctx.query.version,
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao consultar detalhes da trilha', {
        code: 'TRACK_DETAILS_FAILED',
      });
    }
  },
}));
