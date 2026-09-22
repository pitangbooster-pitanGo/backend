import { AiFlowError } from './ai-errors';
import { buildSystemPrompt, buildUserPrompt } from './anthropic-provider';
import type { AiConfig, AiProvider } from './ai-types';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Motivos de término que significam recusa do modelo, não resposta curta. */
const REFUSAL_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
};

/**
 * Assinatura mínima do `fetch`, tipada estruturalmente como o `ClientLike` do
 * provedor Anthropic, para os testes injetarem um duplo.
 */
type FetchLike = (url: string, init: Record<string, unknown>) => Promise<FetchResponse>;

const isAbort = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';

/**
 * Provedor Gemini (Google Generative Language API v1beta) via `fetch`.
 *
 * Fala a mesma interface `AiProvider` do provedor Anthropic e reaproveita os
 * mesmos prompts, então o AIResultValidator segue sendo a única fronteira de
 * confiança e nenhum contrato interno muda. A chave vem exclusivamente da
 * configuração do servidor — nunca do frontend. `fetchImpl` existe para os
 * testes injetarem um duplo.
 */
export const createGeminiProvider = (
  config: AiConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): AiProvider => ({
  name: 'gemini',
  async generate(request, { signal }) {
    const apiKey = config.geminiApiKey ?? '';

    if (!apiKey) {
      throw new AiFlowError(
        'AI_NOT_CONFIGURED',
        'Provedor de IA não configurado: defina GEMINI_API_KEY ou use AI_PROVIDER=mock'
      );
    }

    let response: FetchResponse;

    try {
      response = await fetchImpl(`${API_BASE}/${encodeURIComponent(config.model)}:generateContent`, {
        method: 'POST',
        // A chave vai no cabeçalho, nunca na query string: URL entra em log de
        // proxy e de servidor com muito mais facilidade que um cabeçalho.
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt(request.maxTasks) }] },
          contents: [{ role: 'user', parts: [{ text: buildUserPrompt(request) }] }],
          // Sem `maxOutputTokens`: um corte no meio devolveria JSON truncado,
          // que vira AI_RESULT_INVALID em vez de uma falha clara. O tamanho da
          // estrutura já é limitado por maxTasks no prompt.
          generationConfig: { responseMimeType: 'application/json' },
        }),
        signal,
      });
    } catch (error) {
      if (isAbort(error)) {
        throw new AiFlowError('AI_PROVIDER_TIMEOUT', 'Tempo esgotado ao consultar o provedor de IA');
      }
      // Falha de rede: o AIService classifica como AI_PROVIDER_ERROR.
      throw error;
    }

    if (!response.ok) {
      // Só o status HTTP: o corpo do erro não é repassado ao cliente.
      throw new AiFlowError('AI_PROVIDER_ERROR', 'O provedor de IA retornou um erro', {
        upstreamStatus: response.status,
      });
    }

    let payload: any;
    try {
      payload = await response.json();
    } catch {
      throw new AiFlowError('AI_PROVIDER_ERROR', 'O provedor de IA retornou uma resposta ilegível');
    }

    const candidate = payload?.candidates?.[0];

    if (payload?.promptFeedback?.blockReason || REFUSAL_REASONS.has(candidate?.finishReason)) {
      throw new AiFlowError('AI_PROVIDER_ERROR', 'O provedor de IA recusou a solicitação', {
        reason: 'refusal',
      });
    }

    const text = (candidate?.content?.parts ?? [])
      .filter((part: { text?: unknown }) => typeof part?.text === 'string')
      .map((part: { text: string }) => part.text)
      .join('');

    return { text, model: payload?.modelVersion ?? config.model };
  },
});
