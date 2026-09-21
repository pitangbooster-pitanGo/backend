import type { Core } from '@strapi/strapi';

const config: Core.Config.Middlewares = [
  // Substitui o `strapi::logger` padrão, que registrava apenas
  // "GET /api/tracks (12 ms) 200" no nível `http`, sem requestId nem usuário.
  'global::request-logger',
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      // Inclui x-request-id além do default do Strapi — o apiClient do
      // frontend anexa esse header em toda requisição para correlacionar
      // com as linhas do global::request-logger.
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'x-request-id'],
      // Permite o browser ler o header de volta na resposta (usado em
      // getRequestId para exibir o id em mensagens de erro).
      expose: ['x-request-id'],
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;
