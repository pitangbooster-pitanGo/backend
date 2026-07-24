import { factories } from '@strapi/strapi';

import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';
import {
  createNextTrackSnapshot,
  ensureCurrentTrackSnapshot,
  findTrackSnapshot,
} from '../services/track-versioning';

type TrackRequestBody = {
  data?: Record<string, unknown>;
};

const responseReference = (response: unknown) => {
  const data = (response as { data?: { id?: number; documentId?: string } })?.data;
  return data?.documentId ?? data?.id ?? null;
};

export default factories.createCoreController('api::track.track', () => ({
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

  async details(ctx) {
    try {
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
