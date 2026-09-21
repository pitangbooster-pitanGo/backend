import { winston } from '@strapi/logger';
import type { Core } from '@strapi/strapi';

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

// Comparadas em lowercase — cobre `password`, `Authorization`, `resetPasswordToken`, etc.
const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'passwordconfirmation',
  'token',
  'jwt',
  'accesstoken',
  'refreshtoken',
  'resetpasswordtoken',
  'confirmationtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'apitoken',
  'encryptionkey',
]);

const redactValue = (value: unknown, depth = 0): unknown => {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Corta a recursão com um placeholder — devolver o objeto original aqui
  // reintroduziria ciclos e quebraria a serialização JSON.
  if (depth >= MAX_DEPTH) {
    return Array.isArray(value) ? '[Array]' : '[Object]';
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const key of Object.keys(source)) {
    output[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? REDACTED
      : redactValue(source[key], depth + 1);
  }

  return output;
};

// Só o objeto `info` de topo é mutado (preservando as chaves Symbol do winston);
// os valores aninhados são substituídos por cópias, então o objeto que o chamador
// passou para o logger nunca é alterado.
const redact = winston.format((info) => {
  const record = info as unknown as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    record[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? REDACTED
      : redactValue(record[key]);
  }

  return info;
});

const stringifyMeta = (meta: Record<string, unknown>) => {
  if (Object.keys(meta).length === 0) {
    return '';
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' [meta não serializável]';
  }
};

// O prettyPrint do @strapi/logger imprime apenas `level: message` e descarta o
// metadata — o que tornava invisível todo o contexto passado por
// logControllerError. Este formato imprime o metadata junto.
const developmentFormat = () =>
  winston.format.combine(
    redact(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, ...meta }) => {
      return `[${timestamp}] ${level}: ${message}${stringifyMeta(meta as Record<string, unknown>)}`;
    })
  );

// JSON de uma linha por evento — formato que qualquer agregador (Loki,
// CloudWatch, Datadog) consome sem parser customizado.
const productionFormat = () =>
  winston.format.combine(redact(), winston.format.timestamp(), winston.format.json());

const config = ({ env }: Core.Config.Shared.ConfigParams) => {
  const isProduction = env('NODE_ENV') === 'production';

  return {
    level: env('LOG_LEVEL', isProduction ? 'info' : 'debug'),
    format: isProduction ? productionFormat() : developmentFormat(),
    transports: [new winston.transports.Console()],
  };
};

export default config;
