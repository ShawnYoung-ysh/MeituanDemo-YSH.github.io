export function resolveRoute(hash) {
  if (hash === '' || hash === '#' || hash === '#/' || hash === '#/hall') return { name: 'hall' };
  const pages = { '#/publish': 'publish', '#/tasks': 'tasks', '#/me': 'me', '#/showcase': 'showcase' };
  if (Object.hasOwn(pages, hash)) return { name: pages[hash] };
  const match = /^#\/(task|showcase)\/([^/?#]+)$/.exec(hash);
  if (match) {
    try {
      const id = decodeURIComponent(match[2]);
      if (/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return { name: match[1] === 'task' ? 'task' : 'showcaseTask', taskId: id };
    } catch { /* Malformed URL encoding goes to the not-found page. */ }
  }
  return { name: 'notFound' };
}

export function startRouter(onRoute, host = window) {
  const change = () => onRoute(resolveRoute(host.location.hash));
  host.addEventListener('hashchange', change);
  change();
  return () => host.removeEventListener('hashchange', change);
}
