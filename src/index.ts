import type { Core } from '@strapi/strapi';

type RoleSeed = {
  type: string;
  name: string;
  description: string;
  permissions: string[];
};

type UserSeed = {
  username: string;
  email: string;
  password: string;
  name: string;
  roleType: string;
  isActive: boolean;
};

const managementActions = [
  'api::me.me.meWithRole',
  'api::project.project.find',
  'api::project.project.findOne',
  'api::project.project.create',
  'api::project.project.update',
  'api::project.project.delete',
  'api::track.track.find',
  'api::track.track.findOne',
  'api::track.track.create',
  'api::track.track.update',
  'api::track.track.delete',
  'api::task.task.find',
  'api::task.task.findOne',
  'api::task.task.create',
  'api::task.task.update',
  'api::task.task.delete',
  'api::track-assignment.track-assignment.find',
  'api::track-assignment.track-assignment.findOne',
  'api::track-assignment.track-assignment.create',
  'api::track-assignment.track-assignment.update',
  'api::track-assignment.track-assignment.delete',
  'api::track-assignment.track-assignment.myAssignments',
  'api::task-execution.task-execution.find',
  'api::task-execution.task-execution.findOne',
  'api::task-execution.task-execution.create',
  'api::task-execution.task-execution.update',
  'api::task-execution.task-execution.delete',
  'api::task-execution.task-execution.listForMyAssignment',
  'api::task-execution.task-execution.complete',
  'plugin::users-permissions.role.find',
  'plugin::users-permissions.role.findOne',
  'plugin::users-permissions.user.find',
  'plugin::users-permissions.user.findOne',
  'plugin::users-permissions.user.create',
  'plugin::users-permissions.user.update',
];

const employeeActions = [
  'api::me.me.meWithRole',
  'api::project.project.find',
  'api::project.project.findOne',
  'api::track.track.find',
  'api::track.track.findOne',
  'api::task.task.find',
  'api::task.task.findOne',
  'api::track-assignment.track-assignment.myAssignments',
  'api::task-execution.task-execution.listForMyAssignment',
  'api::task-execution.task-execution.complete',
];

const roleSeeds: RoleSeed[] = [
  {
    type: 'admin',
    name: 'admin',
    description: 'Criar e gerenciar trilhas, tarefas, projetos e visualizar o progresso dos colaboradores.',
    permissions: managementActions,
  },
  {
    type: 'hr',
    name: 'hr',
    description: 'Gerenciar trilhas e tarefas de onboarding, acompanhar colaboradores e operar atribuicoes.',
    permissions: managementActions,
  },
  {
    type: 'leadership',
    name: 'leadership',
    description: 'Gerenciar trilhas e tarefas do time e acompanhar o progresso dos colaboradores.',
    permissions: managementActions,
  },
  {
    type: 'employee',
    name: 'employee',
    description: 'Visualizar projetos, trilhas e tarefas disponiveis para o onboarding.',
    permissions: employeeActions,
  },
];

const userSeeds: UserSeed[] = [
  {
    username: 'admin.pitango',
    email: 'admin@pitango.local',
    password: 'Admin@123',
    name: 'Admin PitanGo',
    roleType: 'admin',
    isActive: true,
  },
  {
    username: 'hr.pitango',
    email: 'hr@pitango.local',
    password: 'Hr@12345',
    name: 'RH PitanGo',
    roleType: 'hr',
    isActive: true,
  },
  {
    username: 'leadership.pitango',
    email: 'leadership@pitango.local',
    password: 'Leader@123',
    name: 'Leadership PitanGo',
    roleType: 'leadership',
    isActive: true,
  },
  {
    username: 'employee.pitango',
    email: 'employee@pitango.local',
    password: 'Employee@123',
    name: 'Employee PitanGo',
    roleType: 'employee',
    isActive: true,
  },
];

const ensureRole = async (strapi: Core.Strapi, roleSeed: RoleSeed) => {
  const existingRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: roleSeed.type },
  });

  if (existingRole) {
    await strapi.db.query('plugin::users-permissions.role').update({
      where: { id: existingRole.id },
      data: {
        name: roleSeed.name,
        description: roleSeed.description,
      },
    });

    return existingRole.id;
  }

  const createdRole = await strapi.db.query('plugin::users-permissions.role').create({
    data: {
      type: roleSeed.type,
      name: roleSeed.name,
      description: roleSeed.description,
    },
  });

  return createdRole.id;
};

const ensureRolePermissions = async (
  strapi: Core.Strapi,
  roleId: number,
  permissions: string[]
) => {
  const existingPermissions = await strapi.db
    .query('plugin::users-permissions.permission')
    .findMany({
      where: {
        role: {
          id: roleId,
        },
      },
    });

  const existingActions = new Set(existingPermissions.map((permission) => permission.action));

  for (const action of permissions) {
    if (existingActions.has(action)) {
      continue;
    }

    await strapi.db.query('plugin::users-permissions.permission').create({
      data: {
        action,
        role: roleId,
      },
    });
  }
};

const ensureSeedUser = async (strapi: Core.Strapi, userSeed: UserSeed) => {
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: userSeed.roleType },
  });

  if (!role) {
    throw new Error(`Role ${userSeed.roleType} nao encontrada para criar usuario seed`);
  }

  const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { email: userSeed.email },
  });

  if (!existingUser) {
    await strapi.plugin('users-permissions').service('user').add({
      username: userSeed.username,
      email: userSeed.email,
      password: userSeed.password,
      provider: 'local',
      confirmed: true,
      blocked: false,
      is_active: userSeed.isActive,
      name: userSeed.name,
      role: role.id,
    });

    return;
  }

  await strapi.plugin('users-permissions').service('user').edit(existingUser.id, {
    username: userSeed.username,
    email: userSeed.email,
    provider: 'local',
    confirmed: true,
    blocked: false,
    is_active: userSeed.isActive,
    name: userSeed.name,
    role: role.id,
  });
};

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    for (const roleSeed of roleSeeds) {
      const roleId = await ensureRole(strapi, roleSeed);
      await ensureRolePermissions(strapi, roleId, roleSeed.permissions);
    }

    for (const userSeed of userSeeds) {
      await ensureSeedUser(strapi, userSeed);
    }
  },
};
