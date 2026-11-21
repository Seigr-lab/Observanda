// Shared by the editor and static builder. Branding never changes content visibility.
export function brandingTargets(book) {
  return [{ target: 'home', label: 'Workspace and website identity' },
    ...book.projects.map(p => ({ target: `project:${p.id}`, label: `Project: ${p.title}` })),
    ...book.notebooks.map(n => ({ target: `notebook:${n.id}`, label: `Lab book: ${n.title}` })),
    ...book.pages.map(p => ({ target: `page:${p.id}`, label: `Page: ${p.title}` })),
    ...book.entries.map(e => ({ target: `entry:${e.id}`, label: `Record: ${e.title}` }))];
}
