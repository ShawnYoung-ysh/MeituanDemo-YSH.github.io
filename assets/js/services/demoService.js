import { DemoError } from '../data/snapshot.js';
import { serviceResult } from './result.js';
import { createTaskService } from './taskService.js';
import { creditFor } from './profileSelectors.js';
import { createReviewService } from './reviewService.js';

export { creditFor } from './profileSelectors.js';

export function createDemoService(repository, options) {
  const safe = serviceResult;
  const taskService = createTaskService(repository, options);
  const session = ({ snapshot, persistence }) => {
    const { db } = snapshot;
    const users = db.users.map(user => ({ ...user, credit: creditFor(db, user.id) }));
    const activeUser = users.find(user => user.id === snapshot.activeUserId);
    return {
      activeUser, users, persistence, initializedAt: snapshot.initializedAt,
      datasetVersion: snapshot.datasetVersion, introAcknowledged: snapshot.preferences.introAcknowledged,
      campus: db.campuses.find(campus => campus.id === activeUser.campusId),
      counts: { tasks: db.tasks.length, users: users.length, locations: db.locations.length },
      sampleTaskId: db.tasks[0]?.id ?? null,
    };
  };
  return {
    initialize: () => safe(async () => session(await repository.initialize())),
    getSession: () => safe(async () => session(await repository.read())),
    switchDemoUser: userId => safe(async () => session(await repository.update(next => {
      if (!next.db.users.some(user => user.id === userId)) throw new DemoError('NOT_FOUND', '未找到这个演示身份。');
      next.activeUserId = userId;
    }))),
    acknowledgeIntro: () => safe(async () => session(await repository.update(next => {
      next.preferences.introAcknowledged = true;
    }))),
    resetDemo: confirmed => safe(async () => session(await repository.reset(confirmed))),
    ...taskService,
    ...createReviewService(repository, options),
  };
}
