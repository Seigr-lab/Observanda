// Preview documents retain their sandbox and publication styles. The host owns
// sizing and scrolling; no script is injected into the published document.
export function previewSurface(iframe, {geometry = () => ({scale: 1}), resized = () => {}, bottom = () => window.innerHeight} = {}) {
  let doc, resize, mutations, pending = 0, disposed = false;
  const schedule = () => { if (!disposed && !pending) pending = requestAnimationFrame(measure); };
  function measure() {
    cancelAnimationFrame(pending); pending = 0;
    if (disposed || !iframe.isConnected) return;
    const {width, scale = 1, container} = geometry();
    if (width) iframe.style.width = width + 'px';
    iframe.style.transform = scale === 1 ? '' : `scale(${scale})`;
    if (!doc?.body) return;
    // body is a flow root with no viewport-dependent minimum. Measuring the
    // root scrollHeight instead would retain the previous iframe height forever.
    const body = doc.body;
    const height = Math.max(1, Math.ceil(body.offsetHeight));
    const border = iframe.offsetHeight - iframe.clientHeight;
    const pixels = (height + border) + 'px';
    if (iframe.style.height !== pixels) iframe.style.height = pixels;
    if (container) {
      container.style.width = Math.ceil(width * scale) + 'px';
      container.style.height = Math.ceil(height * scale) + 'px';
    }
    resized({height, width, scale});
  }
  function detach() {
    resize?.disconnect(); mutations?.disconnect();
    for (const name of ['load', 'loadedmetadata', 'toggle']) doc?.removeEventListener(name, schedule, true);
  }
  function attach() {
    detach(); doc = iframe.contentDocument;
    if (!doc?.body) return;
    doc.documentElement.classList.add('embedded-preview');
    const sheet = doc.createElement('link');
    sheet.rel = 'stylesheet'; sheet.href = '/preview-document.css'; doc.head.append(sheet);
    resize = new ResizeObserver(schedule); resize.observe(doc.body); resize.observe(iframe);
    mutations = new MutationObserver(schedule);
    mutations.observe(doc.body, {childList: true, subtree: true, attributes: true, characterData: true});
    for (const name of ['load', 'loadedmetadata', 'toggle']) doc.addEventListener(name, schedule, true);
    doc.fonts?.ready.then(schedule);
    schedule();
  }
  iframe.addEventListener('load', attach);
  attach();
  function reveal(rect, top = 0) {
    measure();
    const box=iframe.getBoundingClientRect(),scale=box.width/iframe.offsetWidth;
    const first=box.top+rect.top*scale,last=box.top+rect.bottom*scale;
    if(first<top+12)window.scrollBy(0,first-top-12);
    else {const edge=Math.min(window.innerHeight,bottom());if(last>edge-24)window.scrollBy(0,last-edge+24);}
  }
  return {refresh: schedule, measure, reveal, destroy() {
    disposed = true; detach(); cancelAnimationFrame(pending); iframe.removeEventListener('load', attach);
  }};
}
