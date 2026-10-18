export function resolveRoute(hash) {
  if (hash === '' || hash === '#' || hash === '#/' || hash === '#/hall') return { name: 'hall' };
  const pages = { '#/publish': 'publish', '#/tasks': 'tasks', '#/me': 'me' };
  if (Object.hasOwn(pages, hash)) return { name: pages[hash] };
  const match = /^#\/task\/([^/?#]+)$/.exec(hash);
  if (match) {
    try {
      const id = decodeURIComponent(match[1]);
      if (/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return { name: 'task', taskId: id };
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
