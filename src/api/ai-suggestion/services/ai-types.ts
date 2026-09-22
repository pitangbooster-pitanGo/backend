export const ACTION_TYPES = ['reading', 'form', 'upload'] as const;
export const TRACK_TYPES = ['institutional', 'project'] as const;

export type ActionType = (typeof ACTION_TYPES)[number];
export type TrackType = (typeof TRACK_TYPES)[number];

export type SuggestedTask = {
  title: string;
  description: string;
  /** Posição 1-based; sempre igual à posição da tarefa na lista. */
  order_index: number;
  action_type: ActionType;
  requires_evidence: boolean;
  requires_manual_approval: boolean;
  /** Posições (1-based) de tarefas ANTERIORES das quais esta depende. */
  depends_on: number[];
};

export type SuggestedStructure = {
  track: { name: string; description: string; track_type: TrackType };
  tasks: SuggestedTask[];
};

export type CatalogEntry = {
  name: string;
  description?: string | null;
  track_type?: string | null;
};

export type SuggestionWarning = { code: string; message: string };

export type AiConfig = {
  provider: string;
  model: string;
  /** Chave do provedor Anthropic (ANTHROPIC_API_KEY). */
  apiKey: string;
  /** Chave do provedor Gemini (GEMINI_API_KEY). Só AI_PROVIDER=gemini a exige. */
  geminiApiKey?: string;
  timeoutMs: number;
  mcp: { transport: string; serverUrl: string; timeoutMs: number };
};

export type ProviderRequest = {
  goal: string;
  trackType: TrackType;
  existingTracks: CatalogEntry[];
  maxTasks: number;
};

/** Um provedor devolve TEXTO BRUTO: o validador é a única fronteira de confiança. */
export type AiProvider = {
  name: string;
  generate: (
    request: ProviderRequest,
    context: { signal: AbortSignal }
  ) => Promise<{ text: string; model: string }>;
};
