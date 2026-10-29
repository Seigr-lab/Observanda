import {acceptsChildren,childrenOf,descendantsOf,moveElement,compositionText as ct} from './composition-presentation.js';

// Pointer capture remains on the source document while hit-testing the parent
// and its sandboxed canvas. The model, not DOM order, owns the committed move.
export function composerDrag({host,frame,elements,insert,move,announce,activity=()=>{},canvasRoot=null}){
  const controllers=[],win=host.ownerDocument.defaultView,doc=host.ownerDocument;
  let drag=null,keyboard=null,raf=0,suppress=false;
  const marker=doc.createElement('div');marker.className='composer-drop-marker';marker.hidden=true;doc.body.append(marker);
  const ghost=doc.createElement('div');ghost.className='composer-drag-label';ghost.hidden=true;doc.body.append(ghost);
  function coordinates(event,source){
    if(source===doc)return {x:event.clientX,y:event.clientY};
    const rect=frame.getBoundingClientRect(),scale=rect.width/frame.offsetWidth;
    return {x:rect.left+event.clientX*scale,y:rect.top+event.clientY*scale};
  }
  function globalRect(el){
    const r=el.getBoundingClientRect();
    if(el.ownerDocument===doc)return r;
    const b=frame.getBoundingClientRect(),scale=b.width/frame.offsetWidth;
    return {left:b.left+r.left*scale,top:b.top+r.top*scale,width:r.width*scale,height:r.height*scale,right:b.left+r.right*scale,bottom:b.top+r.bottom*scale};
  }
  function hit(x,y){
    let at=doc.elementFromPoint(x,y);
    if(at===frame){const r=frame.getBoundingClientRect(),scale=r.width/frame.offsetWidth;at=frame.contentDocument?.elementFromPoint((x-r.left)/scale,(y-r.top)/scale);}
    if(!at)return null;
    if(at.ownerDocument!==doc&&canvasRoot&&!canvasRoot()?.contains(at))return null;
    const row=at.closest('[data-tree-id]');
    if(row){const element=elements().find(e=>e.id===row.dataset.treeId),r=globalRect(row),center=y>r.top+r.height*.25&&y<r.bottom-r.height*.25;
      if(acceptsChildren(element)&&center)return {parentId:element.id,beforeId:null,rect:r,inside:true};
      return around(element,r,y<r.top+r.height/2);
    }
    const block=at.closest('[data-section-id]'),zone=at.closest('[data-drop-parent]');
    if(zone&&(!block||zone.closest('[data-section-id]')===block))return {parentId:zone.dataset.dropParent||null,beforeId:null,rect:globalRect(zone),inside:true};
    if(block){
      const element=elements().find(e=>e.id===block.dataset.sectionId);if(!element)return null;
      const r=globalRect(block),cx=x>r.left+r.width*.18&&x<r.right-r.width*.18,cy=y>r.top+r.height*.2&&y<r.bottom-r.height*.2;
      if(acceptsChildren(element)&&cx&&cy)return {parentId:element.id,beforeId:null,rect:r,inside:true};
      const parent=elements().find(e=>e.id===element.parentId),horizontal=parent?.layout==='row'||parent?.layout==='grid';
      return around(element,r,horizontal?x<r.left+r.width/2:y<r.top+r.height/2,horizontal);
    }
    if(at.closest('[data-composition],.page-content'))return {parentId:null,beforeId:null,rect:globalRect(at.closest('[data-composition],.page-content')),inside:true};
    return null;
  }
  function around(element,rect,before,horizontal=false){
    if(!element)return null;
    const siblings=childrenOf(elements(),element.parentId??null),index=siblings.findIndex(e=>e.id===element.id);
    return {parentId:element.parentId??null,beforeId:before?element.id:siblings[index+1]?.id??null,rect,horizontal,before};
  }
  function paint(){
    if(!drag?.active)return;
    const dest=hit(drag.x,drag.y),branch=drag.id?descendantsOf(elements(),drag.id):new Set();
    drag.destination=dest&&!branch.has(dest.parentId)&&dest.beforeId!==drag.id?dest:null;
    ghost.hidden=false;ghost.textContent=drag.label;ghost.style.left=drag.x+14+'px';ghost.style.top=drag.y+14+'px';
    marker.hidden=!drag.destination;
    if(!drag.destination)return;
    const {rect:r,inside,horizontal,before}=dest;
    marker.classList.toggle('inside',!!inside);
    Object.assign(marker.style,{left:(inside||!horizontal?r.left:before?r.left:r.right)+'px',top:(inside||horizontal?r.top:before?r.top:r.bottom)+'px',width:(inside||!horizontal?r.width:3)+'px',height:(inside||horizontal?r.height:3)+'px'});
  }
  function tick(){
    if(!drag?.active)return;
    const top=(doc.querySelector('.website-preview-tools')?.getBoundingClientRect().bottom??0);
    const delta=drag.y<Math.min(top,win.innerHeight/2)+28?-14:drag.y>win.innerHeight-36?14:0;
    if(delta)win.scrollBy(0,delta);
    paint();raf=win.requestAnimationFrame(tick);
  }
  function end(commit){
    if(!drag)return;
    const current=drag;drag=null;win.cancelAnimationFrame(raf);marker.hidden=true;ghost.hidden=true;
    doc.body.classList.remove('composer-dragging');
    if(current.active){suppress=true;win.setTimeout(()=>{suppress=false;},0);}
    if(commit&&current.destination){
      const {parentId,beforeId}=current.destination;
      try{if(current.kind)insert(current.kind,parentId,beforeId);else move(current.id,parentId,beforeId);announce(ct('placed'));}catch(e){announce(e.message);}
    }else if(current.active)announce(ct('cancelled'));
    activity(false);
  }
  function bind(source){
    if(!source)return;
    const controller=new source.defaultView.AbortController();controllers.push(controller);const options={signal:controller.signal};
    source.addEventListener('pointerdown',e=>{
      const handle=e.target.closest('[data-element-drag],[data-palette-kind]');
      if(!handle||handle.disabled||e.button!==0||drag||source===doc&&!host.contains(handle))return;
      const point=coordinates(e,source);
      drag={...point,start:point,handle,pointer:e.pointerId,id:handle.dataset.elementDrag,kind:handle.dataset.paletteKind,label:handle.getAttribute('aria-label')||handle.textContent.trim(),active:false};
      activity(true);handle.setPointerCapture(e.pointerId);if(!handle.dataset.paletteKind)e.preventDefault();
    },options);
    source.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==drag.pointer)return;
      Object.assign(drag,coordinates(e,source));
      if(!drag.active&&Math.hypot(drag.x-drag.start.x,drag.y-drag.start.y)>6){drag.active=true;doc.body.classList.add('composer-dragging');announce(ct('highlighted'));tick();}
      if(drag.active)e.preventDefault();
    },options);
    source.addEventListener('pointerup',e=>{if(e.pointerId===drag?.pointer)end(drag.active);},options);
    source.addEventListener('pointercancel',()=>end(false),options);
    source.addEventListener('lostpointercapture',()=>{if(drag)end(false);},options);
    source.addEventListener('click',e=>{if(suppress){e.preventDefault();e.stopImmediatePropagation();}}, {...options,capture:true});
    source.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&keyboard){e.preventDefault();keyboard=null;activity(false);announce(ct('cancelled'));return;}
      if(e.key==='Escape'&&drag){e.preventDefault();end(false);return;}
      const handle=e.target.closest('[data-element-drag]');if(!handle)return;
      const id=handle.dataset.elementDrag,element=elements().find(s=>s.id===id);if(!element)return;
      if([' ','Enter'].includes(e.key)){
        e.preventDefault();
        if(keyboard){const pending=keyboard;keyboard=null;activity(false);try{move(pending.id,pending.parentId,pending.beforeId);announce(ct('placed'));}catch(error){announce(error.message);}host.querySelector('[data-element-drag="'+id+'"]')?.focus({preventScroll:true});}
        else{const siblings=childrenOf(elements(),element.parentId??null);keyboard={id,parentId:element.parentId??null,beforeId:siblings[siblings.findIndex(s=>s.id===id)+1]?.id??null};activity(true);announce(ct('elementPickedUp'));}
        return;
      }
      const arranged=keyboard?moveElement(elements(),id,keyboard.parentId,keyboard.beforeId):elements(),current=arranged.find(s=>s.id===id);
      const siblings=childrenOf(arranged,current.parentId??null),i=siblings.findIndex(s=>s.id===id);
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();let parentId=current.parentId??null,beforeId;
      if(e.key==='ArrowLeft'&&parentId){const parent=elements().find(s=>s.id===parentId);parentId=parent.parentId??null;beforeId=childrenOf(arranged,parentId)[childrenOf(arranged,parentId).findIndex(s=>s.id===parent.id)+1]?.id??null;}
      else if(e.key==='ArrowRight'){const container=siblings[i-1];if(!acceptsChildren(container))return;parentId=container.id;beforeId=null;}
      else if(e.key==='Home')beforeId=siblings[0]?.id??null;
      else if(e.key==='End')beforeId=null;
      else if(e.key==='ArrowUp'){if(!i)return;beforeId=siblings[i-1].id;}
      else if(e.key==='ArrowDown'){if(i===siblings.length-1)return;beforeId=siblings[i+2]?.id??null;}
      else return;
      if(keyboard){keyboard={id,parentId,beforeId};announce(ct('placementSelected'));return;}
      try{move(id,parentId,beforeId);announce(ct('moved'));}catch(error){announce(error.message);}
      host.querySelector('[data-element-drag="'+id+'"]')?.focus({preventScroll:true});
    },options);
  }
  bind(doc);bind(frame?.contentDocument);
  return ()=>{end(false);if(keyboard){keyboard=null;activity(false);}controllers.forEach(c=>c.abort());marker.remove();ghost.remove();};
}
