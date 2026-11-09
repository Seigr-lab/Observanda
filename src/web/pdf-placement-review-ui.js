import {proseDocument, proseText} from './prose-model.js';

// Labels come only from the current, permitted section. Render one window of
// positions at a time even for composed pages with thousands of blocks.
export function pdfPlacementReviewUI({getSection, esc, tr, button}) {
  let sectionId = null, offset = 0;
  const pageSize = 20;
  function rows(section) {
    const blocks = proseDocument(section.content).content ?? [];
    const label = index => {
      const node = blocks[index];
      const excerpt = node && (proseText({type:'doc',content:[node]}) || node.attrs?.title || node.attrs?.alternative || '');
      return tr('compositionBlock') + ' ' + (index + 1) + (excerpt ? ' · ' + excerpt.slice(0,100) : '');
    };
    const gap = block => block >= blocks.length ? tr('placementAtEnd') : tr('placementBefore', {block:label(block)});
    const boxLabel = ({target}) => target.kind === 'block' ? label(target.index) :
      target.kind === 'title' ? section.title : tr(target.kind==='image'?'compositionImage':'compositionNotes');
    const groups = [
      [section.composition?.boxes ?? [], box => tr('compositionTitle')+' · '+boxLabel(box)],
      [section.pagination?.rules ?? [], rule => tr('paginationTitle')+' · '+label(rule.block)],
      [section.images ?? [], image => image.alt+' · '+gap(image.position.block)],
      [section.notes ?? [], note => proseText(note.content).slice(0,100)+' · '+gap(note.block)]
    ];
    const total = groups.reduce((count,[items])=>count+items.length,0), labels = [];
    offset = Math.max(0,Math.min(offset,Math.floor(Math.max(0,total-1)/pageSize)*pageSize));
    let start = offset;
    for (const [items,describe] of groups) {
      if (start < items.length) labels.push(...items.slice(start,start+pageSize-labels.length).map(describe));
      start = Math.max(0,start-items.length);
      if (labels.length===pageSize) break;
    }
    return {labels,total};
  }
  const view = () => '<section class="panel" data-pdf-placement-review hidden aria-live="polite"></section>';
  let current = null, currentHost = null, currentOffset = -1;
  function refresh(host) {
    const panel = host?.querySelector('[data-pdf-placement-review]'), section = getSection();
    if (!panel || !section) return;
    panel.hidden = !section.placementReview;
    if (panel.hidden) { panel.replaceChildren(); current = null; return; }
    if (sectionId !== section.id) { sectionId = section.id; offset = 0; }
    if (current === section && currentHost === panel && currentOffset === offset) return;
    const {labels,total} = rows(section);
    panel.innerHTML = '<h3>'+esc(tr('placementReviewTitle'))+'</h3><p>'+esc(tr('placementReviewHelp'))+'</p><ul>'+
      labels.map(label=>'<li>'+esc(label)+'</li>').join('')+'</ul><div class="pdf-toolbar">'+
      (offset ? button('previous','placement-prev') : '')+(offset+pageSize<total ? button('more','placement-next') : '')+
      button('placementAdjust','placement-adjust')+button('placementConfirm','placement-confirm')+'</div>';
    current = section; currentHost = panel; currentOffset = offset;
  }
  function invalidate() { current = null; }
  function navigate(name, host) {
    if (name === 'placement-adjust') {
      const options = host.querySelector('[data-disclosure="pdf-section-options"]');
      if (options) { options.open=true; options.querySelector('summary').focus(); }
      return true;
    }
    if (!['placement-prev','placement-next'].includes(name)) return false;
    offset += name === 'placement-next' ? pageSize : -pageSize;
    refresh(host);
    const panel=host.querySelector('[data-pdf-placement-review]');
    (panel.querySelector('[data-command="'+name+'"]') ?? panel.querySelector('button'))?.focus();
    return true;
  }
  return {view, refresh, invalidate, navigate};
}
