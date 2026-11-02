// Both editor frames are sandboxed. Resolve links against the actual page,
// and let the host open only files belonging to the current saved revision.
export function savedPageLink(href, pageURL, directory, pages) {
  let url;
  try { url = new URL(href, pageURL); } catch { return null; }
  if (url.origin !== directory.origin || !url.pathname.startsWith(directory.pathname) || url.search || url.username || url.password) return null;
  let path;
  try { path = decodeURIComponent(url.pathname.slice(directory.pathname.length)); } catch { return null; }
  if (!pages.some(page => page.path === path)) return null;
  return {path, hash: url.hash};
}

export function bindSavedLinks(doc, {url, directory, pages, navigate, download, unavailable}) {
  const handle = event => {
    const link = event.target.closest?.('a[href]');
    if (!link || event.defaultPrevented) return;
    event.preventDefault();
    if (event.type === 'auxclick' || event.button !== 0) return;
    const href = link.getAttribute('href');
    const page = savedPageLink(href, url, directory, pages);
    if (page) { navigate(page); return; }
    const asset = new URL(href, url);
    if (download && asset.origin === directory.origin && asset.pathname.startsWith(directory.pathname) && !asset.search && link.hasAttribute('download')) {
      download(asset.href, link.download);
    } else unavailable();
  };
  doc.addEventListener('click', handle);
  doc.addEventListener('auxclick', handle);
  doc.addEventListener('submit', event => event.preventDefault());
}
