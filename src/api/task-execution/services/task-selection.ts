import type { TaskEntity } from './types';

const deduplicateTasks = (tasks: TaskEntity[]) => {
  const taskByDocument = new Map<string | number, TaskEntity>();

  for (const task of tasks) {
    const key = task.documentId ?? task.id;
    const currentTask = taskByDocument.get(key);

    if (!currentTask || (!currentTask.publishedAt && task.publishedAt)) {
      taskByDocument.set(key, task);
    }
  }

  return [...taskByDocument.values()].sort((left, right) => left.order_index - right.order_index);
};

export const getTasksForTrack = async (trackId: number) => {
  const tasks = (await strapi.db.query('api::task.task').findMany({
    where: {
      track: {
        id: trackId,
      },
      is_active: {
        $ne: false,
      },
    },
    populate: ['depends_on'],
    orderBy: {
      order_index: 'asc',
    },
  })) as TaskEntity[];

  return deduplicateTasks(tasks);
};
