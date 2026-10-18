export const creditFor = (db, userId) => Math.min(100,
  db.users.find(user => user.id === userId).creditBase
  + db.creditEvents.filter(event => event.userId === userId).reduce((sum, event) => sum + event.delta, 0));

export function profileFor(db, userId) {
  const user = db.users.find(item => item.id === userId);
  if (!user) return null;
  const reviews = db.reviews.filter(item => item.targetUserId === userId);
  return { ...user, credit: creditFor(db, userId), reviewCount: reviews.length,
    rating: reviews.length ? Number((reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length).toFixed(1)) : null,
    completedAsRunner: db.tasks.filter(task => task.runnerId === userId && task.status === 'completed').length,
    completedAsPublisher: db.tasks.filter(task => task.publisherId === userId && task.status === 'completed').length };
}
