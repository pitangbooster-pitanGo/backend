export type AiErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_PROVIDER_ERROR'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_RESULT_INVALID'
  | 'MCP_TOOL_UNAVAILABLE'
  | 'MCP_TIMEOUT'
  | 'MCP_INVALID_RESPONSE';

const HTTP_STATUS: Record<AiErrorCode, number> = {
  AI_NOT_CONFIGURED: 503,
  AI_PROVIDER_TIMEOUT: 504,
  AI_PROVIDER_ERROR: 502,
  AI_EMPTY_RESPONSE: 502,
  AI_RESULT_INVALID: 502,
  MCP_TOOL_UNAVAILABLE: 502,
  MCP_TIMEOUT: 504,
  MCP_INVALID_RESPONSE: 502,
};

/** Falha previsível do fluxo de IA/MCP, já com o status HTTP que o controller deve devolver. */
export class AiFlowError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: AiErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AiFlowError';
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = details;
  }
}

/**
 * Executa `task` com um limite de tempo. Aborta o `AbortSignal` entregue à
 * tarefa e rejeita com `timeoutError()`, mesmo se a tarefa ignorar o sinal.
 */
export const runWithTimeout = async <T>(
  ms: number,
  task: (signal: AbortSignal) => Promise<T>,
  timeoutError: () => Error
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, ms);
  });

  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
};
