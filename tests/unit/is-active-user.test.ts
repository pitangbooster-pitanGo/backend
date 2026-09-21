import { describe, it, expect, afterEach } from 'vitest';
import { installFakeStrapi, restoreGlobals } from '../helpers/fake-strapi';
import isActiveUser from '../../src/policies/is-active-user';

const USER = 'plugin::users-permissions.user';
const ctx = (id?: number) => ({ state: id === undefined ? {} : { user: { id } } });
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error) => error.details?.code,
  );

afterEach(restoreGlobals);

describe('policy global::is-active-user — bloqueio de usuários inativos', () => {
  it('sem usuário autenticado: AUTH_REQUIRED', async () => {
    installFakeStrapi();
    expect(await codeOf(isActiveUser(ctx()))).toBe('AUTH_REQUIRED');
  });

  it('usuário ativo passa', async () => {
    installFakeStrapi({ [USER]: [{ id: 1, blocked: false, is_active: true }] });
    expect(await isActiveUser(ctx(1))).toBe(true);
  });

  it('usuário sem o campo is_active passa (campo ausente ≠ inativo)', async () => {
    installFakeStrapi({ [USER]: [{ id: 1, blocked: false }] });
    expect(await isActiveUser(ctx(1))).toBe(true);
  });

  it('usuário inexistente: USER_NOT_FOUND', async () => {
    installFakeStrapi({ [USER]: [] });
    expect(await codeOf(isActiveUser(ctx(9)))).toBe('USER_NOT_FOUND');
  });

  it('usuário bloqueado: USER_BLOCKED', async () => {
    const { log } = installFakeStrapi({ [USER]: [{ id: 1, blocked: true, is_active: true }] });
    expect(await codeOf(isActiveUser(ctx(1)))).toBe('USER_BLOCKED');
    expect(log.warn).toHaveBeenCalled();
  });

  it('usuário com is_active=false: USER_INACTIVE', async () => {
    installFakeStrapi({ [USER]: [{ id: 1, blocked: false, is_active: false }] });
    expect(await codeOf(isActiveUser(ctx(1)))).toBe('USER_INACTIVE');
  });

  it('falha na consulta ao banco: POLICY_ACTIVE_USER_LOOKUP_FAILED', async () => {
    const { db, log } = installFakeStrapi();
    db.query.mockImplementation(() => {
      throw new Error('timeout');
    });
    expect(await codeOf(isActiveUser(ctx(1)))).toBe('POLICY_ACTIVE_USER_LOOKUP_FAILED');
    expect(log.error).toHaveBeenCalled();
  });
});
