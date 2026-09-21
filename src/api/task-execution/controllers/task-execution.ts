import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import type { UID } from '@strapi/types';

import { logControllerError, rethrowStrapiError } from '../../../utils/controller-error';
import { logEvent } from '../../../utils/logger';

const { ValidationError } = errors;
const taskEvidenceUid = 'api::task-evidence.task-evidence' as UID.ContentType;

const parseId = (value: string) => {
  const parsedId = Number(value);

  return Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;
};

const parseBodyData = (data: unknown) => {
  if (!data) {
    return {};
  }

  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      throw new ValidationError('Payload de evidencia invalido', {
        code: 'TASK_EVIDENCE_PAYLOAD_INVALID',
      });
    }
  }

  return typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
};

const executionReference = (ctx) =>
  ctx.params.executionDocumentId ?? ctx.params.id;

type RawExecution = { id: number; evidences?: unknown };

/**
 * Reanexa as evidências ao resultado já sanitizado.
 *
 * `sanitizeOutput` do task-execution REMOVE a relação `evidences` para o
 * colaborador: a role `employee` não tem permissão de leitura em
 * `api::task-evidence` (revogada de propósito no seed), e a sanitização por
 * permissão derruba a relação inteira. O efeito era o colaborador nunca ver as
 * próprias evidências — o upload dava certo, mas a tela continuava pedindo
 * evidência e a conclusão travava na validação do cliente.
 *
 * Estes endpoints já validam a posse (a execução é da atribuição do próprio
 * usuário), então sanitizamos as evidências contra o content-type delas —
 * mesmo caminho que `attachEvidence` sempre usou.
 */
const attachSanitizedEvidences = async (
  ctx,
  sanitized: unknown,
  raw: RawExecution | RawExecution[] | null
) => {
  const evidenceContentType = strapi.contentType(taskEvidenceUid);
  const rawList = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const evidencesByExecutionId = new Map(rawList.map((item) => [item.id, item.evidences ?? []]));

  const withEvidences = async (execution: { id?: number } | null) => {
    if (!execution) {
      return execution;
    }

    return {
      ...execution,
      evidences: await strapi.contentAPI.sanitize.output(
        evidencesByExecutionId.get(execution.id as number) ?? [],
        evidenceContentType,
        { auth: ctx.state.auth }
      ),
    };
  };

  if (Array.isArray(sanitized)) {
    return Promise.all((sanitized as Array<{ id?: number }>).map(withEvidences));
  }

  return withEvidences(sanitized as { id?: number } | null);
};

const handleReview = async (
  controller: any,
  ctx,
  decision: 'approve' | 'reject'
) => {
  const authUser = ctx.state.user;
  const reference = executionReference(ctx);

  if (!authUser) {
    return ctx.unauthorized('Autenticacao obrigatoria', { code: 'AUTH_REQUIRED' });
  }

  if (typeof reference !== 'string' || reference.length === 0) {
    return ctx.badRequest('Identificador da execucao invalido', {
      code: 'TASK_EXECUTION_ID_INVALID',
      id: reference,
    });
  }

  await controller.validateQuery(ctx);
  await controller.sanitizeQuery(ctx);

  try {
    const bodyData = parseBodyData(ctx.request.body?.data ?? ctx.request.body);
    const execution = await strapi
      .service('api::task-execution.task-execution')
      .reviewExecution(
        reference,
        authUser.id,
        decision,
        typeof bodyData.review_feedback === 'string'
          ? bodyData.review_feedback
          : null
      );
    logEvent(decision === 'approve' ? 'task-execution.approved' : 'task-execution.rejected', {
      executionReference: reference,
      reviewerUserId: authUser.id,
      decision,
    });

    const sanitizedExecution = await controller.sanitizeOutput(execution, ctx);

    return controller.transformResponse(sanitizedExecution);
  } catch (error) {
    rethrowStrapiError(error);
    logControllerError(`task-execution.${decision}`, error, {
      executionReference: reference,
      reviewerUserId: authUser.id,
    });
    return ctx.internalServerError('Falha ao avaliar execucao', {
      code: 'TASK_EXECUTION_REVIEW_FAILED',
      executionReference: reference,
    });
  }
};

export default factories.createCoreController('api::task-execution.task-execution', () => ({
  async listForMyAssignment(ctx) {
    try {
      const authUser = ctx.state.user;
      const assignmentId = parseId(ctx.params.id);

      if (!authUser) {
        return ctx.unauthorized('Autenticacao obrigatoria', {
          code: 'AUTH_REQUIRED',
        });
      }

      if (assignmentId === null) {
        return ctx.badRequest('Identificador da atribuicao invalido', {
          code: 'TRACK_ASSIGNMENT_ID_INVALID',
          id: ctx.params.id,
        });
      }

      await this.validateQuery(ctx);
      await this.sanitizeQuery(ctx);

      const assignment = await strapi.db.query('api::track-assignment.track-assignment').findOne({
        where: { id: assignmentId },
        populate: ['user', 'track'],
      });

      if (!assignment) {
        return ctx.notFound('Atribuicao nao encontrada', {
          code: 'TRACK_ASSIGNMENT_NOT_FOUND',
          assignmentId,
        });
      }

      if (assignment.user?.id !== authUser.id) {
        return ctx.forbidden('Usuario sem acesso a esta atribuicao', {
          code: 'TRACK_ASSIGNMENT_FORBIDDEN',
          assignmentId,
          userId: authUser.id,
        });
      }

      const executions = await strapi
        .service('api::task-execution.task-execution')
        .listExecutionsForAssignment(assignmentId);
      const sanitizedExecutions = await attachSanitizedEvidences(
        ctx,
        await this.sanitizeOutput(executions, ctx),
        executions as RawExecution[]
      );

      return this.transformResponse(sanitizedExecutions);
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task-execution.listForMyAssignment', error, {
        assignmentId: ctx.params.id,
        userId: ctx.state.user?.id,
      });
      return ctx.internalServerError('Falha ao listar tarefas da atribuicao', {
        code: 'TASK_EXECUTIONS_LIST_FAILED',
        assignmentId: ctx.params.id,
      });
    }
  },

  async complete(ctx) {
    const authUser = ctx.state.user;
    const reference = executionReference(ctx);

    if (!authUser) {
      return ctx.unauthorized('Autenticacao obrigatoria', {
        code: 'AUTH_REQUIRED',
      });
    }

    if (typeof reference !== 'string' || reference.length === 0) {
      return ctx.badRequest('Identificador da execucao invalido', {
        code: 'TASK_EXECUTION_ID_INVALID',
        id: reference,
      });
    }

    await this.validateQuery(ctx);
    await this.sanitizeQuery(ctx);

    try {
      await strapi
        .service('api::task-execution.task-execution')
        .completeExecution(reference, authUser.id);

      logEvent('task-execution.completed', {
        executionReference: reference,
        userId: authUser.id,
      });
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task-execution.complete', error, {
        executionReference: reference,
        userId: authUser.id,
      });
      return ctx.internalServerError('Falha ao concluir tarefa', {
        code: 'TASK_EXECUTION_COMPLETE_FAILED',
        executionReference: reference,
      });
    }

    try {
      const execution = await strapi.db.query('api::task-execution.task-execution').findOne({
        where: /^\d+$/.test(reference)
          ? { id: Number(reference) }
          : { documentId: reference },
        populate: {
          track_assignment: true,
          validated_by: true,
          evidences: {
            populate: ['file', 'submitted_by'],
          },
        },
      });
      const sanitizedExecution = await attachSanitizedEvidences(
        ctx,
        await this.sanitizeOutput(execution, ctx),
        execution as RawExecution | null
      );

      return this.transformResponse(sanitizedExecution);
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task-execution.complete.response', error, {
        executionReference: reference,
        userId: authUser.id,
      });
      return ctx.internalServerError('Tarefa concluida, mas houve falha ao carregar a resposta', {
        code: 'TASK_EXECUTION_RESPONSE_LOAD_FAILED',
        executionReference: reference,
      });
    }
  },

  async attachEvidence(ctx) {
    const authUser = ctx.state.user;
    const reference = executionReference(ctx);

    if (!authUser) {
      return ctx.unauthorized('Autenticacao obrigatoria', {
        code: 'AUTH_REQUIRED',
      });
    }

    if (typeof reference !== 'string' || reference.length === 0) {
      return ctx.badRequest('Identificador da execucao invalido', {
        code: 'TASK_EXECUTION_ID_INVALID',
        id: reference,
      });
    }

    await this.validateQuery(ctx);
    await this.sanitizeQuery(ctx);

    try {
      const bodyData = parseBodyData(ctx.request.body?.data ?? ctx.request.body);
      const evidences = await strapi
        .service('api::task-execution.task-execution')
        .attachEvidenceToExecution({
          executionReference: reference,
          userId: authUser.id,
          files: ctx.request.files?.files ?? ctx.request.files?.file,
          evidenceType:
            bodyData.evidence_type === 'file' || bodyData.evidence_type === 'link'
              ? bodyData.evidence_type
              : null,
          externalUrl:
            typeof bodyData.external_url === 'string' ? bodyData.external_url : null,
          notes: typeof bodyData.notes === 'string' ? bodyData.notes : null,
        });
      logEvent('task-evidence.attached', {
        executionReference: reference,
        userId: authUser.id,
        evidenceCount: Array.isArray(evidences) ? evidences.length : 1,
      });

      const evidenceContentType = strapi.contentType(taskEvidenceUid);
      const sanitizedEvidences = await strapi.contentAPI.sanitize.output(
        evidences,
        evidenceContentType,
        {
          auth: ctx.state.auth,
        }
      );

      ctx.status = 201;
      return { data: sanitizedEvidences };
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task-execution.attachEvidence', error, {
        executionReference: reference,
        userId: authUser.id,
      });
      return ctx.internalServerError('Falha ao anexar evidencia', {
        code: 'TASK_EVIDENCE_ATTACH_FAILED',
        executionReference: reference,
      });
    }
  },

  async removeEvidence(ctx) {
    const authUser = ctx.state.user;
    const reference = executionReference(ctx);
    const evidenceReference = ctx.params.evidenceDocumentId;

    if (!authUser) {
      return ctx.unauthorized('Autenticacao obrigatoria', {
        code: 'AUTH_REQUIRED',
      });
    }

    if (
      typeof reference !== 'string' ||
      reference.length === 0 ||
      typeof evidenceReference !== 'string' ||
      evidenceReference.length === 0
    ) {
      return ctx.badRequest('Identificador de evidencia invalido', {
        code: 'TASK_EVIDENCE_ID_INVALID',
      });
    }

    await this.validateQuery(ctx);
    await this.sanitizeQuery(ctx);

    try {
      await strapi
        .service('api::task-execution.task-execution')
        .removeEvidenceFromExecution({
          executionReference: reference,
          evidenceReference,
          userId: authUser.id,
        });

      logEvent('task-evidence.removed', {
        executionReference: reference,
        evidenceReference,
        userId: authUser.id,
      });

      ctx.status = 204;
    } catch (error) {
      rethrowStrapiError(error);
      logControllerError('task-execution.removeEvidence', error, {
        executionReference: reference,
        evidenceReference,
        userId: authUser.id,
      });
      return ctx.internalServerError('Falha ao remover evidencia', {
        code: 'TASK_EVIDENCE_REMOVE_FAILED',
        executionReference: reference,
        evidenceReference,
      });
    }
  },

  async approve(ctx) {
    return handleReview(this, ctx, 'approve');
  },

  async reject(ctx) {
    return handleReview(this, ctx, 'reject');
  },
}));
