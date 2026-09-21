import { isDeepStrictEqual } from 'node:util';

import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import type { UID } from '@strapi/types';

import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';
import { findEntity } from '../../../utils/relation-reference';
import { logEvent } from '../../../utils/logger';
import { AiFlowError } from '../services/ai-errors';
import { validateAiResult } from '../services/ai-result-validator';
import { TRACK_TYPES, type SuggestedStructure, type TrackType } from '../services/ai-types';
import { generateSuggestionDraft } from '../services/suggestion-generation';
import { materializeSuggestion } from '../services/suggestion-materialization';

const UID_AI_SUGGESTION = 'api::ai-suggestion.ai-suggestion' as UID.ContentType;

const MIN_GOAL_LENGTH = 10;
const MAX_GOAL_LENGTH = 2000;
const MAX_REVIEW_NOTES = 1000;

// Nome físico da tabela (collectionName do schema) — usado só no claim atômico de status.
const SUGGESTIONS_TABLE = 'ai_suggestions';

type SuggestionRecord = Record<string, unknown> & { id: number; documentId?: string };
type TrackRef = { id: number; documentId?: string | null; name?: string | null };

const cleanNotes = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** Falha de negócio de uma ação de revisão — vira 400 com `details.code` estável. */
const reviewError = (message: string, code: string, details: Record<string, unknown> = {}) =>
  new errors.ApplicationError(message, { code, ...details });

/**
 * Reivindica a sugestão de forma ATÔMICA: só uma revisão concorrente vence o
 * `UPDATE ... WHERE status = 'pending_review'` (a outra vê 0 linhas e falha).
 */
const claimForReview = async (
  trx: (table: string) => any,
  suggestionId: number,
  status: 'approved' | 'edited' | 'rejected'
) => {
  const affected = await trx(SUGGESTIONS_TABLE)
    .where({ id: suggestionId, status: 'pending_review' })
    .update({ status });

  if (!affected) {
    throw reviewError('Esta sugestão já foi revisada', 'AI_SUGGESTION_NOT_PENDING');
  }
};

const loadSuggestion = async (ctx: any) => {
  const suggestion = await findEntity<SuggestionRecord>(UID_AI_SUGGESTION, ctx.params.id as string);
  if (!suggestion) {
    throw new errors.NotFoundError('Sugestão não encontrada', { code: 'AI_SUGGESTION_NOT_FOUND' });
  }
  return suggestion;
};

/** Valida uma estrutura editada por uma pessoa; erro de formato aqui é 400, não 502. */
const validateEditedStructure = (edited: unknown, trackType: TrackType): SuggestedStructure => {
  try {
    return validateAiResult(JSON.stringify(edited ?? null), { trackType }).structure;
  } catch (error) {
    if (error instanceof AiFlowError) {
      throw new errors.ValidationError('A estrutura editada é inválida', {
        code: 'AI_SUGGESTION_EDIT_INVALID',
        issues: error.details.issues,
      });
    }
    throw error;
  }
};

/** Formato de resposta do recurso — mesmo envelope `{ data }` das demais APIs. */
export const toSuggestionResponse = (record: SuggestionRecord, track?: TrackRef | null) => ({
  id: record.id,
  documentId: record.documentId,
  goal: record.goal,
  track_type: record.track_type,
  status: record.status,
  original_result: record.original_result,
  final_result: record.final_result ?? null,
  warnings: record.warnings ?? [],
  provider: record.provider,
  model: record.model,
  reviewed_at: record.reviewed_at ?? null,
  review_notes: record.review_notes ?? null,
  track: track ? { id: track.id, documentId: track.documentId ?? null, name: track.name ?? null } : null,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export default factories.createCoreController('api::ai-suggestion.ai-suggestion', () => ({
  /**
   * POST /api/ai-suggestions — GERA um rascunho e o grava como `pending_review`.
   * Não cria trilha nem tarefa: isso só acontece numa aprovação humana explícita.
   */
  async create(ctx) {
    const authUser = ctx.state.user;

    if (!authUser) {
      return ctx.unauthorized('Autenticação obrigatória', { code: 'AUTH_REQUIRED' });
    }

    const data = (ctx.request.body?.data ?? {}) as Record<string, unknown>;
    const goal = typeof data.goal === 'string' ? data.goal.trim() : '';

    if (goal.length < MIN_GOAL_LENGTH || goal.length > MAX_GOAL_LENGTH) {
      throw new errors.ValidationError(
        `Descreva o objetivo com ${MIN_GOAL_LENGTH} a ${MAX_GOAL_LENGTH} caracteres`,
        { code: 'AI_GOAL_INVALID' }
      );
    }

    const trackType: TrackType = TRACK_TYPES.includes(data.track_type as TrackType)
      ? (data.track_type as TrackType)
      : 'project';

    try {
      const draft = await generateSuggestionDraft({ goal, trackType });

      const created = (await strapi.db.query(UID_AI_SUGGESTION).create({
        data: {
          goal,
          track_type: trackType,
          status: 'pending_review',
          original_result: draft.structure,
          final_result: null,
          warnings: draft.warnings,
          provider: draft.provider,
          model: draft.model,
          created_by_user: authUser.id,
        },
      })) as SuggestionRecord;

      logEvent('ai_suggestion.generated', {
        suggestionId: created.documentId ?? created.id,
        provider: draft.provider,
        taskCount: draft.structure.tasks.length,
        warningCount: draft.warnings.length,
      });

      ctx.status = 201;
      return { data: toSuggestionResponse(created) };
    } catch (error) {
      if (error instanceof AiFlowError) {
        logControllerError('ai-suggestion.create', error, { userId: authUser.id, code: error.code });
        ctx.status = error.status;
        // Só o código e a mensagem segura — `cause` (detalhe interno) não sai daqui.
        const { cause: _cause, ...safeDetails } = error.details;
        ctx.body = {
          data: null,
          error: {
            status: error.status,
            name: 'AiFlowError',
            message: error.message,
            details: { code: error.code, ...safeDetails },
          },
        };
        return;
      }

      rethrowStrapiError(error);
      logControllerError('ai-suggestion.create', error, { userId: authUser.id });
      return ctx.internalServerError('Falha ao gerar a sugestão', {
        code: 'AI_SUGGESTION_CREATE_FAILED',
      });
    }
  },

  /**
   * POST /api/ai-suggestions/:id/approve — revisão humana que APROVA (opcionalmente
   * editando). Só aqui a trilha e as tarefas passam a existir de verdade.
   * Body opcional: { data: { final_result?: <estrutura editada>, review_notes? } }
   */
  async approve(ctx) {
    const authUser = ctx.state.user;
    if (!authUser) {
      return ctx.unauthorized('Autenticação obrigatória', { code: 'AUTH_REQUIRED' });
    }

    try {
      const data = (ctx.request.body?.data ?? {}) as Record<string, unknown>;
      const suggestion = await loadSuggestion(ctx);

      if (suggestion.status !== 'pending_review') {
        throw reviewError('Esta sugestão já foi revisada', 'AI_SUGGESTION_NOT_PENDING');
      }

      const notes = cleanNotes(data.review_notes);
      if (notes.length > MAX_REVIEW_NOTES) {
        throw new errors.ValidationError(`Observações excedem ${MAX_REVIEW_NOTES} caracteres`, {
          code: 'AI_SUGGESTION_NOTES_INVALID',
        });
      }

      const original = suggestion.original_result as SuggestedStructure;
      const finalStructure =
        data.final_result === undefined
          ? original
          : validateEditedStructure(data.final_result, suggestion.track_type as TrackType);
      const edited = !isDeepStrictEqual(finalStructure, original);

      const { updated, track } = await strapi.db.transaction(async ({ trx }) => {
        await claimForReview(trx, suggestion.id, edited ? 'edited' : 'approved');

        const created = await materializeSuggestion(finalStructure, authUser.id);

        const row = (await strapi.db.query(UID_AI_SUGGESTION).update({
          where: { id: suggestion.id },
          data: {
            final_result: finalStructure,
            reviewed_by_user: authUser.id,
            reviewed_at: new Date().toISOString(),
            review_notes: notes || null,
            track: created.track.id,
          },
        })) as SuggestionRecord;

        return { updated: row, track: created.track as TrackRef };
      });

      logEvent(edited ? 'ai_suggestion.edited' : 'ai_suggestion.approved', {
        suggestionId: suggestion.documentId ?? suggestion.id,
        trackId: track.documentId ?? track.id,
        reviewerId: authUser.id,
      });

      return { data: toSuggestionResponse(updated, track) };
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('ai-suggestion.approve', error, { userId: authUser.id });
      return ctx.internalServerError('Falha ao aprovar a sugestão', {
        code: 'AI_SUGGESTION_APPROVE_FAILED',
      });
    }
  },

  /**
   * POST /api/ai-suggestions/:id/reject — revisão humana que REJEITA. Exige motivo;
   * nada é criado.
   */
  async reject(ctx) {
    const authUser = ctx.state.user;
    if (!authUser) {
      return ctx.unauthorized('Autenticação obrigatória', { code: 'AUTH_REQUIRED' });
    }

    try {
      const data = (ctx.request.body?.data ?? {}) as Record<string, unknown>;
      const notes = cleanNotes(data.review_notes);

      if (!notes || notes.length > MAX_REVIEW_NOTES) {
        throw new errors.ValidationError(
          `Informe o motivo da rejeição (até ${MAX_REVIEW_NOTES} caracteres)`,
          { code: 'AI_SUGGESTION_REJECTION_NOTES_REQUIRED' }
        );
      }

      const suggestion = await loadSuggestion(ctx);

      const updated = await strapi.db.transaction(async ({ trx }) => {
        await claimForReview(trx, suggestion.id, 'rejected');

        return (await strapi.db.query(UID_AI_SUGGESTION).update({
          where: { id: suggestion.id },
          data: {
            reviewed_by_user: authUser.id,
            reviewed_at: new Date().toISOString(),
            review_notes: notes,
          },
        })) as SuggestionRecord;
      });

      logEvent('ai_suggestion.rejected', {
        suggestionId: suggestion.documentId ?? suggestion.id,
        reviewerId: authUser.id,
      });

      return { data: toSuggestionResponse(updated) };
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('ai-suggestion.reject', error, { userId: authUser.id });
      return ctx.internalServerError('Falha ao rejeitar a sugestão', {
        code: 'AI_SUGGESTION_REJECT_FAILED',
      });
    }
  },
}));
