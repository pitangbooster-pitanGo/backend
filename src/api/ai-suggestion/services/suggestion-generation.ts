import { logWarn } from '../../../utils/logger';
import { AiFlowError } from './ai-errors';
import { requestStructure } from './ai-service';
import { validateAiResult, MAX_TASKS } from './ai-result-validator';
import { fetchExistingTracksCatalog, type McpTool } from './mcp-service';
import type {
  AiConfig,
  AiProvider,
  CatalogEntry,
  SuggestedStructure,
  SuggestionWarning,
  TrackType,
} from './ai-types';

export const getAiConfig = (): AiConfig => strapi.config.get('ai') as AiConfig;

export type SuggestionDraft = {
  structure: SuggestedStructure;
  warnings: SuggestionWarning[];
  provider: string;
  model: string;
};

type Deps = {
  provider?: AiProvider;
  mcpTools?: Record<string, McpTool>;
};

/**
 * Fluxo: (1) MCP fornece o contexto → (2) AIService gera → (3) AIResultValidator
 * valida/normaliza → devolve um RASCUNHO.
 *
 * Este módulo nunca cria trilha/tarefa: o resultado é só uma proposta que
 * precisa de revisão humana (ver controller `approve`). O contexto MCP é
 * enriquecimento — se falhar, a geração segue sem ele e o aviso
 * MCP_CONTEXT_UNAVAILABLE é gravado para o revisor ver.
 */
export const generateSuggestionDraft = async (
  input: { goal: string; trackType: TrackType },
  config: AiConfig = getAiConfig(),
  deps: Deps = {}
): Promise<SuggestionDraft> => {
  const warnings: SuggestionWarning[] = [];
  let existingTracks: CatalogEntry[] = [];

  try {
    existingTracks = await fetchExistingTracksCatalog(config.mcp, { tools: deps.mcpTools });
  } catch (error) {
    if (!(error instanceof AiFlowError)) {
      throw error;
    }
    logWarn('ai.suggestion', 'Contexto MCP indisponível; gerando sem catálogo', {
      code: error.code,
      details: error.details,
    });
    warnings.push({
      code: 'MCP_CONTEXT_UNAVAILABLE',
      message: `Não foi possível consultar as trilhas existentes (${error.code}); a sugestão foi gerada sem checar duplicidades.`,
    });
  }

  const { raw, provider, model } = await requestStructure(
    {
      goal: input.goal,
      trackType: input.trackType,
      existingTracks,
      maxTasks: MAX_TASKS,
    },
    config,
    deps.provider
  );

  const validated = validateAiResult(raw, { trackType: input.trackType, existingTracks });

  return {
    structure: validated.structure,
    warnings: [...warnings, ...validated.warnings],
    provider,
    model,
  };
};
