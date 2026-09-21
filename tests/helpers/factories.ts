import { getTestStrapi } from '../setup/strapi-instance';

let seq = 0;

/** Sufixo único por chamada — evita colisão de nome/email entre execuções da suíte. */
export function uniqueSuffix(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

type TrackTypeInput = 'institutional' | 'project';

export async function createTrack(overrides: {
  name?: string;
  description?: string;
  track_type?: TrackTypeInput;
  is_active?: boolean;
  created_by_user?: number;
} = {}) {
  const strapi = await getTestStrapi();
  const suffix = uniqueSuffix();

  const track = await strapi.db.query('api::track.track').create({
    data: {
      name: overrides.name ?? `Trilha de teste ${suffix}`,
      description: overrides.description ?? 'Trilha criada por fixture de teste',
      track_type: overrides.track_type ?? 'institutional',
      version: 1,
      is_active: overrides.is_active ?? true,
      created_by_user: overrides.created_by_user ?? null,
    },
  });

  const { ensureCurrentTrackSnapshot } = await import(
    '../../src/api/track/services/track-versioning'
  );
  await ensureCurrentTrackSnapshot(track.id, overrides.created_by_user);

  return track as { id: number; documentId: string; name: string; version: number };
}

export async function createTask(
  trackId: number,
  overrides: {
    title?: string;
    order_index?: number;
    action_type?: 'reading' | 'form' | 'upload' | 'external_link';
    requires_evidence?: boolean;
    requires_manual_approval?: boolean;
    depends_on?: number[];
    is_active?: boolean;
  } = {},
) {
  const strapi = await getTestStrapi();
  const suffix = uniqueSuffix();

  const task = await strapi.db.query('api::task.task').create({
    data: {
      title: overrides.title ?? `Tarefa de teste ${suffix}`,
      description: 'Tarefa criada por fixture de teste',
      order_index: overrides.order_index ?? 1,
      action_type: overrides.action_type ?? 'reading',
      is_required: true,
      is_active: overrides.is_active ?? true,
      requires_evidence: overrides.requires_evidence ?? false,
      requires_manual_approval: overrides.requires_manual_approval ?? false,
      track: trackId,
      depends_on: overrides.depends_on ?? [],
    },
  });

  // Cada criação de tarefa deve gerar uma nova versão da trilha, como o
  // controller real faz (ver src/api/task/controllers/task.ts) — os
  // testes de integração usam o service diretamente, então replicamos
  // aqui explicitamente.
  const { createNextTrackSnapshot } = await import(
    '../../src/api/track/services/track-versioning'
  );
  await createNextTrackSnapshot(trackId);

  return task as { id: number; documentId: string; title: string };
}

export async function createTestUser(overrides: {
  role: 'admin' | 'hr' | 'leadership' | 'employee';
  email?: string;
  name?: string;
  is_active?: boolean;
} = { role: 'employee' }) {
  const strapi = await getTestStrapi();
  const suffix = uniqueSuffix();
  const email = overrides.email ?? `test-${overrides.role}-${suffix}@pitang.test`;

  const role = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: overrides.role },
  });
  if (!role) {
    throw new Error(`Role "${overrides.role}" não encontrada — seedUsersPermissions rodou?`);
  }

  const user = await strapi.plugin('users-permissions').service('user').add({
    username: `test.${overrides.role}.${suffix}`,
    email,
    password: 'TestPassword@123',
    provider: 'local',
    confirmed: true,
    blocked: false,
    is_active: overrides.is_active ?? true,
    name: overrides.name ?? `Teste ${overrides.role} ${suffix}`,
    role: role.id,
  });

  return { ...user, plainPassword: 'TestPassword@123' } as {
    id: number;
    documentId: string;
    email: string;
    plainPassword: string;
  };
}

export async function assignTrackToUser(trackId: number, userId: number, assignedByUserId: number) {
  const strapi = await getTestStrapi();

  return strapi.service('api::track-assignment.track-assignment').assignTrackToUser({
    data: { track: trackId, user: userId },
    assignedByUserId,
  });
}

export async function getExecutionsForAssignment(trackAssignmentId: number) {
  const strapi = await getTestStrapi();
  return strapi.db.query('api::task-execution.task-execution').findMany({
    where: { track_assignment: { id: trackAssignmentId } },
    orderBy: { id: 'asc' },
  });
}
