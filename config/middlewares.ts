import type { Core } from '@strapi/strapi';

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      // Inclui x-request-id além do default do Strapi — o apiClient do
      // frontend anexa esse header em toda requisição para correlacionar
      // com as linhas de log do backend.
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'x-request-id'],
      // Permite o browser ler o header de volta na resposta (usado para
      // exibir o id da requisição em mensagens de erro).
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
