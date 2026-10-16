// Reorders presentation items only; callers own validation, drafts and persistence.
export function bindReorder(root, {commit, announce, label='Panel'}) {
  if (!root) return () => {};
  const doc=root.ownerDocument,win=doc.defaultView;
  const hostFrame=win.frameElement,host=hostFrame?.ownerDocument.defaultView;
  const controller = new win.AbortController(), options = {signal: controller.signal};
  let drag = null, frame = null;
  const rows = () => [...root.querySelectorAll('[data-reorder-item]')];
  function paint() {
    rows().forEach((row, i) => {
      row.classList.toggle('reorder-origin', i === drag?.from);
      row.classList.toggle('reorder-target', i === drag?.to);
    });
  }
  function scrollTick(){
    if(!drag||drag.pointer===undefined||!drag.moved){frame=null;return;}
    let x=drag.latestX,y=drag.latestY;
    if(hostFrame){
      const tools=hostFrame.ownerDocument.querySelector('.website-preview-tools');
      const top=Math.max(0,tools?.getBoundingClientRect().bottom??0);
      const delta=drag.hostY<top+48?-12:drag.hostY>host.innerHeight-48?12:0;
      if(delta)host.scrollBy(0,delta);
      const box=hostFrame.getBoundingClientRect(),scale=box.width/hostFrame.offsetWidth;
      x=(drag.hostX-box.left)/scale;y=(drag.hostY-box.top)/scale;
    }else{
      let container=root.parentElement;
      while(container&&!(container.scrollHeight>container.clientHeight&&/(auto|scroll)/.test(win.getComputedStyle(container).overflowY)))container=container.parentElement;
      const box=container?container.getBoundingClientRect():{top:0,bottom:win.innerHeight};
      const top=Math.max(0,box.top),bottom=Math.min(win.innerHeight,box.bottom);
      const delta=y<top+48?-12:y>bottom-48?12:0;
      if(delta)(container??doc.scrollingElement).scrollBy(0,delta);
    }
    const row=doc.elementFromPoint(Math.max(0,Math.min(win.innerWidth-1,x)),Math.max(0,Math.min(win.innerHeight-1,y)))?.closest('[data-reorder-item]');
    if(row&&root.contains(row)){drag.to=rows().indexOf(row);paint();}
    frame=win.requestAnimationFrame(scrollTick);
  }
  function end(apply) {
    if (!drag) return;
    if(frame!==null)win.cancelAnimationFrame(frame);frame=null;
    const {from, to, key} = drag; drag = null; paint();
    announce(apply ? `${label} moved to position ${to + 1}.` : 'Move cancelled.');
    if (apply && from !== to) commit(from, to, key);
  }
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-reorder-handle]');
    if (!handle || event.button !== 0 || drag) return;
    event.preventDefault();handle.focus();handle.setPointerCapture(event.pointerId);
    const from = rows().indexOf(handle.closest('[data-reorder-item]'));
    drag = {from, to:from, key:handle.dataset.reorderHandle, pointer:event.pointerId, y:event.clientY, x:event.clientX, moved:false};
  }, options);
  root.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientY-drag.y,event.clientX-drag.x) < 5) return;
    drag.moved = true;drag.latestX=event.clientX;drag.latestY=event.clientY;
    if(hostFrame){const box=hostFrame.getBoundingClientRect(),scale=box.width/hostFrame.offsetWidth;drag.hostX=box.left+event.clientX*scale;drag.hostY=box.top+event.clientY*scale;}if(frame===null)frame=win.requestAnimationFrame(scrollTick);
    const row = doc.elementFromPoint(event.clientX,event.clientY)?.closest('[data-reorder-item]');
    if (row && root.contains(row)) drag.to=rows().indexOf(row);
    paint();

  }, options);
  root.addEventListener('pointerup', event => {if(drag?.pointer===event.pointerId)end(drag.moved);},options);
  root.addEventListener('pointercancel', () => end(false),options);
  root.addEventListener('lostpointercapture', () => {if(drag?.pointer!==undefined)end(false);},options);
  root.addEventListener('keydown', event => {
    const handle=event.target.closest('[data-reorder-handle]');if(!handle)return;
    if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();end(false);return;}
    if([' ','Enter'].includes(event.key)) {
      event.preventDefault();
      if(drag){end(true);return;}
      const from=rows().indexOf(handle.closest('[data-reorder-item]'));
      drag={from,to:from,key:handle.dataset.reorderHandle};paint();
      announce(`${label} picked up. Use arrow keys, then Space to place or Escape to cancel.`);return;
    }
    if(drag&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      event.preventDefault();drag.to=event.key==='Home'?0:event.key==='End'?rows().length-1:Math.max(0,Math.min(rows().length-1,drag.to+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)));
      paint();announce(`Position ${drag.to+1} of ${rows().length}.`);
    }
  },options);
  root.addEventListener('focusout', ()=>{if(drag&&drag.pointer===undefined)end(false);},options);
  return () => {controller.abort();drag=null;if(frame!==null)win.cancelAnimationFrame(frame);};
}
