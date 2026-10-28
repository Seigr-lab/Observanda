// Update the rendered document in place. Stable element/media nodes retain
// focus, loaded media and selection while the surrounding controls change.
export function reconcileCanvas(live,incoming,{editor=null}={}){
  const key=n=>{
    if(n.nodeType!==1)return null;
    if(n.dataset.sectionId)return 'element:'+n.dataset.sectionId;
    if(n.dataset.mediaId)return 'media:'+n.dataset.mediaScope+':'+n.dataset.mediaId;
    if(n.id)return 'id:'+n.id;
    if(n.dataset.composition)return 'composition:'+n.dataset.composition;
    const section=n.closest('[data-section-id]');
    if(section){
      if(n.matches('.prose'))return 'prose:'+section.dataset.sectionId;
      if(n.matches('.hero-copy'))return 'copy:'+section.dataset.sectionId;
      if(n.parentElement===section&&/^H[1-6]$/.test(n.nodeName))return 'heading:'+section.dataset.sectionId;
    }
    return null;
  };
  // Transient canvas controls are not published siblings. Matching content
  // against those buttons by position used to detach live editing surfaces.
  for(const node of live.querySelectorAll('.canvas-section-handle,.canvas-section-edit,.canvas-section-remove,.canvas-empty-media,[data-drop-parent]'))node.remove();
  const existing=new Map([...live.querySelectorAll('[data-section-id],[data-media-id],[data-composition],[id],.prose,.hero-copy,h1,h2,h3,h4,h5,h6')].map(n=>[key(n),n]).filter(([key])=>key!==null));
  function patch(target,source){
    if(target.nodeType===3){if(target.nodeValue!==source.nodeValue)target.nodeValue=source.nodeValue;return;}
    if(target.nodeType!==1||target===editor)return;
    for(const a of [...target.attributes])if(!source.hasAttribute(a.name)&&!['data-keyboard-bound','data-heading-bound'].includes(a.name))target.removeAttribute(a.name);
    for(const a of source.attributes)if(target.getAttribute(a.name)!==a.value)target.setAttribute(a.name,a.value);
    if(editor&&target.contains(editor)&&target.matches('.prose'))return;
    let position=target.firstChild;
    for(const next of [...source.childNodes]){
      const k=key(next);
      let match=k?existing.get(k):position&&key(position)===null&&position.nodeType===next.nodeType&&position.nodeName===next.nodeName?position:null;
      if(!match||match.nodeName!==next.nodeName||match===target||match.contains?.(target))match=next.cloneNode(true);
      if(match!==position)target.insertBefore(match,position);
      patch(match,next);position=match.nextSibling;
    }
    while(position){const after=position.nextSibling;position.remove();position=after;}
  }
  patch(live,incoming);
}
