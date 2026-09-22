import { AiFlowError, runWithTimeout } from './ai-errors';
import { createAnthropicProvider } from './anthropic-provider';
import { createGeminiProvider } from './gemini-provider';
import { mockProvider } from './mock-provider';
import type { AiConfig, AiProvider, ProviderRequest } from './ai-types';

/** Resolve o provedor configurado em AI_PROVIDER. */
export const getProvider = (config: AiConfig): AiProvider => {
  switch (config.provider) {
    case 'mock':
      return mockProvider;
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'gemini':
      return createGeminiProvider(config);
    default:
      throw new AiFlowError(
        'AI_NOT_CONFIGURED',
        `Provedor de IA desconhecido: "${config.provider}" (use "mock", "anthropic" ou "gemini")`
      );
  }
};

/**
 * AIService — pede ao provedor uma estrutura de trilha e devolve o TEXTO BRUTO.
 *
 * Responsabilidades: aplicar o timeout, traduzir qualquer falha do provedor
 * (rede, HTTP, exceção inesperada) em `AiFlowError` com código estável e
 * rejeitar resposta vazia. NÃO interpreta o conteúdo — isso é do
 * AIResultValidator.
 */
export const requestStructure = async (
  request: ProviderRequest,
  config: AiConfig,
  provider: AiProvider = getProvider(config)
): Promise<{ raw: string; provider: string; model: string }> => {
  let response: { text: string; model: string };

  try {
    response = await runWithTimeout(
      config.timeoutMs,
      (signal) => provider.generate(request, { signal }),
      () =>
        new AiFlowError('AI_PROVIDER_TIMEOUT', 'Tempo esgotado ao consultar o provedor de IA', {
          provider: provider.name,
          timeoutMs: config.timeoutMs,
        })
    );
  } catch (error) {
    if (error instanceof AiFlowError) {
      throw error;
    }
    // Falha inesperada do provedor: a causa fica só nos logs do servidor.
    throw new AiFlowError('AI_PROVIDER_ERROR', 'Falha ao consultar o provedor de IA', {
      provider: provider.name,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (typeof response?.text !== 'string' || response.text.trim() === '') {
    throw new AiFlowError('AI_EMPTY_RESPONSE', 'O provedor de IA retornou uma resposta vazia', {
      provider: provider.name,
    });
  }

  return { raw: response.text, provider: provider.name, model: response.model };
};
