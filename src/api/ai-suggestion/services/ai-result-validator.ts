import { AiFlowError } from './ai-errors';
import {
  ACTION_TYPES,
  TRACK_TYPES,
  type ActionType,
  type CatalogEntry,
  type SuggestedStructure,
  type SuggestedTask,
  type SuggestionWarning,
  type TrackType,
} from './ai-types';

export const MAX_TASKS = 20;
const MAX_TRACK_NAME = 120;
const MAX_TITLE = 150;
const MAX_DESCRIPTION = 1000;
const MAX_ISSUES_REPORTED = 20;

type Issue = { path: string; message: string };

// Remove caracteres de controle (exceto quebra de linha e tabulação).
const cleanText = (value: unknown) =>
  typeof value === 'string'
    ? value
        .replace(/\p{Cc}/gu, (char) => (char === '\n' || char === '\t' ? char : ''))
        .trim()
    : '';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (issues: Issue[]) =>
  new AiFlowError('AI_RESULT_INVALID', 'A resposta da IA não segue o formato esperado', {
    issues: issues.slice(0, MAX_ISSUES_REPORTED),
  });

/** Extrai o objeto JSON de uma resposta que pode vir com cercas de markdown ou texto ao redor. */
const extractJson = (raw: string): unknown => {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  }

  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw invalid([{ path: '$', message: 'Nenhum objeto JSON encontrado na resposta' }]);
    }
    text = text.slice(start, end + 1);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw invalid([{ path: '$', message: 'JSON inválido' }]);
  }
};

type ValidateOptions = {
  /** Tipo usado quando a IA omite ou devolve um `track_type` inválido. */
  trackType: TrackType;
  existingTracks?: CatalogEntry[];
  maxTasks?: number;
};

/**
 * AIResultValidator — valida e NORMALIZA a saída bruta do modelo.
 *
 * Nada que a IA devolva chega ao restante do sistema sem passar por aqui:
 * só campos conhecidos são copiados (whitelist), tipos são checados, e as
 * mesmas regras de dependência do backend (dependência estritamente anterior)
 * são exigidas — a IA nunca propõe algo que a criação real rejeitaria.
 */
export const validateAiResult = (
  raw: string,
  options: ValidateOptions
): { structure: SuggestedStructure; warnings: SuggestionWarning[] } => {
  const maxTasks = options.maxTasks ?? MAX_TASKS;
  const parsed = extractJson(raw);
  const issues: Issue[] = [];

  if (!isRecord(parsed)) {
    throw invalid([{ path: '$', message: 'A resposta deve ser um objeto' }]);
  }

  const rawTrack = parsed.track;
  const trackName = isRecord(rawTrack) ? cleanText(rawTrack.name) : '';
  if (!trackName) {
    issues.push({ path: 'track.name', message: 'Nome da trilha é obrigatório' });
  } else if (trackName.length > MAX_TRACK_NAME) {
    issues.push({ path: 'track.name', message: `Nome excede ${MAX_TRACK_NAME} caracteres` });
  }

  const trackDescription = isRecord(rawTrack) ? cleanText(rawTrack.description) : '';
  if (trackDescription.length > MAX_DESCRIPTION) {
    issues.push({ path: 'track.description', message: `Descrição excede ${MAX_DESCRIPTION} caracteres` });
  }

  const rawTrackType = isRecord(rawTrack) ? rawTrack.track_type : undefined;
  const trackType = TRACK_TYPES.includes(rawTrackType as TrackType)
    ? (rawTrackType as TrackType)
    : options.trackType;

  const rawTasks = parsed.tasks;
  const tasks: SuggestedTask[] = [];

  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    issues.push({ path: 'tasks', message: 'A trilha precisa de ao menos uma tarefa' });
  } else if (rawTasks.length > maxTasks) {
    issues.push({ path: 'tasks', message: `A trilha excede o limite de ${maxTasks} tarefas` });
  } else {
    rawTasks.forEach((rawTask, index) => {
      const position = index + 1;
      const path = `tasks[${index}]`;

      if (!isRecord(rawTask)) {
        issues.push({ path, message: 'Tarefa deve ser um objeto' });
        return;
      }

      const title = cleanText(rawTask.title);
      if (!title) {
        issues.push({ path: `${path}.title`, message: 'Título é obrigatório' });
      } else if (title.length > MAX_TITLE) {
        issues.push({ path: `${path}.title`, message: `Título excede ${MAX_TITLE} caracteres` });
      }

      const description = cleanText(rawTask.description);
      if (description.length > MAX_DESCRIPTION) {
        issues.push({ path: `${path}.description`, message: `Descrição excede ${MAX_DESCRIPTION} caracteres` });
      }

      const actionType = rawTask.action_type ?? 'reading';
      const actionTypeValid = ACTION_TYPES.includes(actionType as ActionType);
      if (!actionTypeValid) {
        issues.push({
          path: `${path}.action_type`,
          message: `Tipo de ação inválido (permitidos: ${ACTION_TYPES.join(', ')})`,
        });
      }

      const rawDeps = rawTask.depends_on ?? [];
      const dependsOn: number[] = [];
      if (!Array.isArray(rawDeps)) {
        issues.push({ path: `${path}.depends_on`, message: 'depends_on deve ser uma lista' });
      } else {
        for (const dependency of rawDeps) {
          if (!Number.isInteger(dependency) || dependency < 1 || dependency >= position) {
            issues.push({
              path: `${path}.depends_on`,
              message: `Dependência ${JSON.stringify(dependency)} inválida: só é permitido depender de tarefas anteriores (posições 1 a ${position - 1})`,
            });
          } else if (dependsOn.includes(dependency)) {
            issues.push({ path: `${path}.depends_on`, message: `Dependência ${dependency} repetida` });
          } else {
            dependsOn.push(dependency);
          }
        }
      }

      tasks.push({
        title,
        description,
        order_index: position,
        action_type: actionTypeValid ? (actionType as ActionType) : 'reading',
        requires_evidence: rawTask.requires_evidence === true,
        requires_manual_approval: rawTask.requires_manual_approval === true,
        depends_on: dependsOn.sort((left, right) => left - right),
      });
    });
  }

  if (issues.length > 0) {
    throw invalid(issues);
  }

  const warnings: SuggestionWarning[] = [];
  const knownNames = new Set(
    (options.existingTracks ?? []).map((track) => track.name.trim().toLowerCase())
  );
  if (knownNames.has(trackName.toLowerCase())) {
    warnings.push({
      code: 'DUPLICATE_TRACK_NAME',
      message: `Já existe uma trilha chamada "${trackName}". Revise antes de aprovar para evitar duplicidade.`,
    });
  }

  const seenTitles = new Set<string>();
  for (const task of tasks) {
    const key = task.title.toLowerCase();
    if (seenTitles.has(key)) {
      warnings.push({
        code: 'DUPLICATE_TASK_TITLE',
        message: `Título de tarefa repetido: "${task.title}".`,
      });
    }
    seenTitles.add(key);
  }

  return {
    structure: {
      track: { name: trackName, description: trackDescription, track_type: trackType },
      tasks,
    },
    warnings,
  };
};
