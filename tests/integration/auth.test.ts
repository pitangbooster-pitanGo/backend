import { describe, it, expect } from 'vitest';
import { api, loginAs, authHeader, DEMO_CREDENTIALS } from '../helpers/http';

describe('Autenticação', () => {
  it('login válido retorna jwt e usuário', async () => {
    const client = await api();
    const res = await client.post('/api/auth/local').send(DEMO_CREDENTIALS.admin);

    expect(res.status).toBe(200);
    expect(res.body.jwt).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(DEMO_CREDENTIALS.admin.identifier);
  });

  it('login inválido retorna 400', async () => {
    const client = await api();
    const res = await client
      .post('/api/auth/local')
      .send({ identifier: DEMO_CREDENTIALS.admin.identifier, password: 'senha-errada' });

    expect(res.status).toBe(400);
  });

  it('rota protegida sem autenticação retorna 401/403', async () => {
    const client = await api();
    const res = await client.get('/api/tracks');

    expect([401, 403]).toContain(res.status);
  });

  it('rota protegida com token válido retorna 200', async () => {
    const { token } = await loginAs('admin');
    const client = await api();
    const res = await client.get('/api/tracks').set(authHeader(token));

    expect(res.status).toBe(200);
  });

  it('GET /api/me com token retorna o usuário autenticado com role', async () => {
    const { token } = await loginAs('employee');
    const client = await api();
    const res = await client.get('/api/me').set(authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body.role?.type).toBe('employee');
  });
});
