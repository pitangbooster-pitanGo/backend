import { describe, it, expect, afterEach } from 'vitest';
import { installFakeStrapi, restoreGlobals } from '../helpers/fake-strapi';
import hasRole from '../../src/policies/has-role';

const USER = 'plugin::users-permissions.user';
const ctx = (id?: number) => ({ state: id === undefined ? {} : { user: { id } } });
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error) => error.details?.code,
  );

afterEach(restoreGlobals);

describe('policy global::has-role — autorização por perfil', () => {
  it('sem usuário autenticado: AUTH_REQUIRED', async () => {
    installFakeStrapi();
    expect(await codeOf(hasRole(ctx(), { roles: ['admin'] }))).toBe('AUTH_REQUIRED');
  });

  it('sem roles configuradas: qualquer usuário autenticado passa (sem consultar o banco)', async () => {
    const { db } = installFakeStrapi();
    expect(await hasRole(ctx(1), {})).toBe(true);
    expect(await hasRole(ctx(1))).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('perfil permitido (por type) passa', async () => {
    installFakeStrapi({ [USER]: [{ id: 1, role: { type: 'hr', name: 'HR' } }] });
    expect(await hasRole(ctx(1), { roles: ['admin', 'hr'] })).toBe(true);
  });

  it('perfil permitido (por name) também passa', async () => {
    installFakeStrapi({ [USER]: [{ id: 1, role: { type: 'x', name: 'Leadership' } }] });
    expect(await hasRole(ctx(1), { roles: ['Leadership'] })).toBe(true);
  });

  it('perfil fora da lista: USER_ROLE_FORBIDDEN e registra o acesso negado', async () => {
    const { log } = installFakeStrapi({ [USER]: [{ id: 1, role: { type: 'employee' } }] });
    expect(await codeOf(hasRole(ctx(1), { roles: ['admin', 'hr'] }))).toBe('USER_ROLE_FORBIDDEN');
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Acesso negado por perfil'),
      expect.objectContaining({ currentRole: 'employee' }),
    );
  });

  it('usa o name no log quando o perfil não tem type', async () => {
    const { log } = installFakeStrapi({ [USER]: [{ id: 1, role: { name: 'Custom' } }] });
    await codeOf(hasRole(ctx(1), { roles: ['admin'] }));
    expect(log.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ currentRole: 'Custom' }));
  });

  it('usuário sem perfil atribuído: USER_ROLE_NOT_FOUND', async () => {
    installFakeStrapi({ [USER]: [{ id: 1, role: null }] });
    expect(await codeOf(hasRole(ctx(1), { roles: ['admin'] }))).toBe('USER_ROLE_NOT_FOUND');
  });

  it('usuário inexistente no banco: USER_ROLE_NOT_FOUND', async () => {
    installFakeStrapi({ [USER]: [] });
    expect(await codeOf(hasRole(ctx(7), { roles: ['admin'] }))).toBe('USER_ROLE_NOT_FOUND');
  });

  it('falha na consulta ao banco: POLICY_ROLE_LOOKUP_FAILED (não vaza o erro interno)', async () => {
    const { db, log } = installFakeStrapi();
    db.query.mockImplementation(() => {
      throw new Error('conexão perdida');
    });
    expect(await codeOf(hasRole(ctx(1), { roles: ['admin'] }))).toBe('POLICY_ROLE_LOOKUP_FAILED');
    expect(log.error).toHaveBeenCalled();
  });
});
