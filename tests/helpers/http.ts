import request from 'supertest';
import { getTestStrapi } from '../setup/strapi-instance';

/** Cliente supertest ligado direto ao httpServer do Strapi de teste — sem bind de porta. */
export async function api() {
  const strapi = await getTestStrapi();
  return request(strapi.server.httpServer);
}

export const DEMO_CREDENTIALS = {
  admin: { identifier: 'admin@pitango.local', password: 'Admin@123' },
  hr: { identifier: 'hr@pitango.local', password: 'Hr@12345' },
  leadership: { identifier: 'leadership@pitango.local', password: 'Leader@123' },
  employee: { identifier: 'employee@pitango.local', password: 'Employee@123' },
} as const;

export type DemoRole = keyof typeof DEMO_CREDENTIALS;

export async function loginAs(role: DemoRole): Promise<{ token: string; userId: number }> {
  const client = await api();
  const { identifier, password } = DEMO_CREDENTIALS[role];
  const res = await client.post('/api/auth/local').send({ identifier, password });

  if (res.status !== 200) {
    throw new Error(
      `Falha ao logar como "${role}" (${identifier}): ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  return { token: res.body.jwt as string, userId: res.body.user.id as number };
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
