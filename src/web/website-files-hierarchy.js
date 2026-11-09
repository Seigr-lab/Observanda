import {websiteLayerAt,movableWebsiteLayer,reorderableWebsiteLayer,websiteLayerMove,layerPath,indexWebsiteLayers,refreshLayerLabel,foldLayerText} from './website-layer-model.js';
import {finderGroups,openWebsiteFinder} from './website-files-finder.js';
import {websiteFrameGeometry} from './website-file-viewport.js';
export {websiteLayerAt,movableWebsiteLayer,websiteLayerMove} from './website-layer-model.js';

const pageSize=48,dragType='application/x-observanda-website-layer';
export function websiteHierarchy({t,site,enabled,available,snapshot,read,edit,button,escape,openPage,selectLayer,retainSelection,notify}){
 let root,list,controls,model,observer,chosen=null,query='',offset=0,expanded=new Set(),drag=null,marker,line,closeDialog,hostEvents;
 let scope='';
 const siteKey=()=>{const entry=site();return entry?[entry.site.id,entry.site.revision,entry.path].join('|'):'';};
 const ready=()=>root?.isConnected&&enabled()&&available();
 const node=(tag,text)=>{const el=root.ownerDocument.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
 function reset(){
  closeDialog?.();hostEvents?.abort();removeMark();model=list=controls=root=null;query='';expanded=new Set();offset=0;chosen=drag=null;scope='';
 }
 function stamp(){return {scope:siteKey(),html:snapshot()};}
 function current(pin){return ready()&&pin.scope===siteKey()&&pin.html===snapshot();}
 function visibleRows(){
  if(!model)return [];
  if(query){const tokens=foldLayerText(query.trim()).split(/\s+/);return model.rows.filter(row=>tokens.every(token=>row.search.includes(token)));}
  const rows=[];let closedDepth=Infinity;
  for(const row of model.rows){
   if(row.depth>closedDepth)continue;
   rows.push(row);closedDepth=row.branch&&!expanded.has(row.path)?row.depth:Infinity;
  }
  return rows;
 }
 function focusRow(path){
  const row=[...(list?.children??[])].find(n=>n.dataset.path===path);
  row?.querySelector('[data-layer-select]')?.focus({preventScroll:true});row?.scrollIntoView({block:'nearest'});
 }
 function actionButton(key,attr,extra=''){
  return '<button type="button" class="button" data-layer-'+attr+' '+extra+'>'+escape(t(key))+'</button>';
 }
 function draw(){
  if(!list?.isConnected||!model)return;
  const visible=visibleRows();offset=Math.max(0,Math.min(offset,Math.max(0,Math.floor((visible.length-1)/pageSize)*pageSize)));
  const window=visible.slice(offset,offset+pageSize);
  list.innerHTML=window.map(row=>{
   const {node,path,depth,label}=row,attr='data-path="'+escape(path)+'"',active=chosen===path,movable=reorderableWebsiteLayer(node);
   const toggle=row.branch?'<button type="button" class="website-layer-toggle" data-layer-toggle aria-label="'+escape(t(expanded.has(path)?'layerCollapse':'layerExpand'))+'" aria-expanded="'+String(!!query||expanded.has(path))+'" '+(query?'disabled':'')+'>'+((query||expanded.has(path))?'▾':'▸')+'</button>':'';
   const labelButton='<button class="website-layer-label" type="button" data-layer-select aria-pressed="'+String(active)+'">'+escape(label)+'</button>';
   const dragLabel=escape(t('layerDragHint',{name:label}));
   const handle=movable?'<button class="website-layer-grip" type="button" data-layer-grip draggable="true" aria-label="'+dragLabel+'" title="'+dragLabel+'">⠿</button>':'';
   let actions='';
   if(active){
    actions=button('sectionEdit','edit-block',attr);
    if(movable){
     actions+=actionButton('layerMove','move')+
      button('up','move-up',attr+(websiteLayerMove(node,node.previousElementSibling,'before')?'':' disabled'))+
      button('down','move-down',attr+(websiteLayerMove(node,node.nextElementSibling,'after')?'':' disabled'));
     if(movableWebsiteLayer(node))actions+=button('duplicate','duplicate',attr)+button('remove','remove',attr);
    }
   }
   return '<li '+attr+' data-level="'+Math.min(depth,3)+'" '+(active?'aria-current="true" ':'')+(movable?'draggable="true"':'')+
    '><span>'+handle+toggle+labelButton+'</span>'+(actions?'<div class="website-layer-actions">'+actions+'</div>':'')+'</li>';
  }).join('');
  const count=controls.querySelector('[data-layer-count]');count.textContent=visible.length?String(offset+1)+'–'+String(offset+window.length)+' / '+String(visible.length):t('finderEmpty');
  for(const [key,disabled] of [['previous',offset===0],['next',offset+pageSize>=visible.length]]){
   const b=controls.querySelector('[data-layer-'+key+']');b.disabled=disabled;b.hidden=visible.length<=pageSize;
  }
 }
 function selection(path){
  if(!path||!model?.byPath.has(path))return;
  const row=model.byPath.get(path);let changed=chosen!==path;
  for(let p=row.parent;p;p=p.parent)if(!expanded.has(p.path)){expanded.add(p.path);changed=true;}
  if(!changed)return;chosen=path;
  let visible=visibleRows(),index=visible.indexOf(row);
  if(index<0&&query){query='';controls.querySelector('input').value='';visible=visibleRows();index=visible.indexOf(row);}
  offset=Math.max(0,Math.floor(index/pageSize)*pageSize);draw();paintTrail();
 }
 function paint(host,doc){
  if(host!==list)bindList(host);
  observer?.disconnect();
  model=indexWebsiteLayers(doc);draw();paintTrail();
  observer=new MutationObserver(records=>updateRows(doc,records));
  observer.observe(doc.body,{subtree:true,characterData:true,childList:true,attributes:true,attributeFilter:['id','aria-label','alt','class','hidden','data-section-id','data-region-kind','data-observanda-source','data-observanda-link','data-observanda-part','data-observanda-editor','data-image-gallery','data-website-source-gallery','data-website-recording','data-website-feed','data-website-instance','data-website-menu','data-website-annotation']});
 }
 function updateRows(doc,records){
  if(!model||!list?.isConnected)return;
  const affected=new Set();
  for(const record of records){
   const el=record.target.nodeType===1?record.target:record.target.parentElement;
   if(!el||el.closest('[data-observanda-editor]')&&record.attributeName!=='data-observanda-editor')continue;
   if(record.type==='attributes'&&!['id','aria-label','alt'].includes(record.attributeName)||record.type==='childList'&&
      [...record.addedNodes,...record.removedNodes].some(n=>n.nodeType===1&&!n.hasAttribute('data-observanda-editor'))){
    const current=model.byPath.get(chosen)?.node,branches=[...expanded].map(path=>model.byPath.get(path)?.node);
    model=indexWebsiteLayers(doc);expanded=new Set(branches.map(node=>model.byNode.get(node)?.path).filter(Boolean));
    chosen=model.byNode.get(current)?.path??null;if(current)retainSelection(chosen);
    draw();paintTrail();return;
   }
   for(let n=el;n&&n!==doc.body;n=n.parentElement){const row=model.byNode.get(n);if(row)affected.add(row);}
  }
  const tokens=query?foldLayerText(query).split(/\s+/):[],matches=row=>tokens.every(token=>row.search.includes(token));
  let redraw=false,relabel=false;
  for(const row of affected){
   const wasVisible=matches(row);if(!refreshLayerLabel(row))continue;
   relabel=true;if(wasVisible!==matches(row)){redraw=true;continue;}
   const item=list.querySelector('li[data-path="'+row.path+'"]');if(!item)continue;
   item.querySelector('[data-layer-select]').textContent=row.label;
   const grip=item.querySelector('[data-layer-grip]');if(grip){grip.title=t('layerDragHint',{name:row.label});grip.setAttribute('aria-label',grip.title);}
  }
  if(redraw)draw();if(relabel)paintTrail();
 }
 function paintTrail(){
  const trail=root?.querySelector('[data-layer-trail]');if(!trail)return;
  const file=node('span',site().path);file.className='website-trail-file';file.title=site().path;trail.replaceChildren(file);
  let row=model?.byPath.get(chosen);const visible=[];
  while(row&&visible.length<3){visible.unshift(row);row=row.parent;}
  if(row)trail.append(node('span','…'));
  for(const item of visible){
   const active=item.path===chosen,crumb=node(active?'span':'button',item.label);crumb.title=item.label;
   if(active)crumb.setAttribute('aria-current','location');
   else{crumb.type='button';crumb.dataset.layerAncestor=item.path;crumb.setAttribute('aria-label',t('selectAncestor',{name:item.label}));}
   trail.append(crumb);
  }
 }
 function choose(path,canvasFocus){
  selection(path);selectLayer(path);
  if(canvasFocus){const frame=root?.querySelector('#website-files-canvas');frame?.contentWindow?.focus();}
  else focusRow(path);
 }
 function dispatchMove(pin,from,to,position){
  if(!current(pin)){notify();return;}
  const doc=read(),operation=websiteLayerMove(websiteLayerAt(doc,from),websiteLayerAt(doc,to),position);
  if(!operation){notify();return;}
  edit(saved=>{const apply=websiteLayerMove(websiteLayerAt(saved,from),websiteLayerAt(saved,to),position);if(!apply)throw Error(t('layerMoveUnavailable'));retainSelection(apply());});
 }
 function openFinder(from){
  if(!ready()||closeDialog||root.ownerDocument.querySelector('dialog[open]'))return;
  const pin=stamp(),index=model??indexWebsiteLayers(read());
  let groups;
  if(from){
   const moving=index.byPath.get(from);if(!reorderableWebsiteLayer(moving?.node))return;
   groups=['inside','before','after'].map(position=>({title:t('layer'+position[0].toUpperCase()+position.slice(1)),items:function*(){
    for(const row of index.rows)yield {name:row.label,detail:row.node.localName+' · '+row.path,allowed:()=>!!websiteLayerMove(moving.node,row.node,position),run:()=>dispatchMove(pin,from,row.path,position)};
   }}));
  }else groups=finderGroups({site:site().site,root,rows:index.rows,t,openPage,selectLayer:path=>choose(path,true)});
  closeDialog=openWebsiteFinder({doc:root.ownerDocument,title:t(from?'layerMove':'finderOpen'),groups,t,valid:()=>current(pin),onClose:()=>{closeDialog=null;}});
 }
 function bindKeys(doc){
  doc.addEventListener('keydown',event=>{
   if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='k'&&ready()){
    event.preventDefault();openFinder();
   }
  },{signal:hostEvents.signal});
 }
 function bindHost(doc){
  const key=siteKey();if(key!==scope||!enabled()){reset();scope=key;}
  else{closeDialog?.();hostEvents?.abort();model=list=controls=null;drag=null;removeMark();}
  root=doc.querySelector('[data-website-file-controls]');if(!root||!enabled())return;
  hostEvents=new AbortController();hostEvents.signal.addEventListener('abort',()=>{observer?.disconnect();observer=null;},{once:true});bindKeys(doc);
  const trail=root.querySelector('[data-layer-trail]');if(trail)trail.onclick=event=>{const at=event.target.closest('[data-layer-ancestor]');if(at)choose(at.dataset.layerAncestor,true);};
  const header=root.querySelector('.website-workspace-utilities')??root.querySelector('header');if(!header)return;
  let trigger=header.querySelector('[data-website-finder]');
  if(!trigger){trigger=node('button',t('finderOpen'));trigger.type='button';trigger.dataset.websiteFinder='';trigger.className='button';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-keyshortcuts','Control+K Meta+K');header.append(trigger);}
  trigger.onclick=()=>openFinder();
 }
 function bindList(host){
  if(!root||host===list)return;list=host;
  controls=host.previousElementSibling?.matches('[data-layer-controls]')?host.previousElementSibling:node('div');controls.dataset.layerControls='';
  controls.innerHTML='<input type="search" aria-label="'+escape(t('layerFilter'))+'" placeholder="'+escape(t('layerFilter'))+'">'+
   '<div><small data-layer-count></small>'+actionButton('layerPrevious','previous')+actionButton('layerNext','next')+'</div>';
  host.before(controls);const input=controls.querySelector('input');input.value=query;
  input.oninput=()=>{query=input.value.trim();offset=0;draw();};
  controls.onclick=e=>{if(e.target.closest('[data-layer-previous]')){offset-=pageSize;draw();}if(e.target.closest('[data-layer-next]')){offset+=pageSize;draw();}};
  host.onclick=e=>{
   const row=e.target.closest('li[data-path]');if(!row)return;const path=row.dataset.path;
   if(e.target.closest('[data-layer-toggle]')){if(expanded.has(path))expanded.delete(path);else expanded.add(path);draw();list.querySelector('li[data-path="'+path+'"] [data-layer-toggle]')?.focus({preventScroll:true});}
   else if(e.target.closest('[data-layer-select]'))choose(path,false);
   else if(e.target.closest('[data-layer-move],[data-layer-grip]'))openFinder(path);
  };
  host.ondragstart=e=>{
   const row=e.target.closest('li[draggable="true"]');if(row)startDrag(e,row.dataset.path);
  };
  host.ondragend=endDrag;
  drops(host,e=>{const row=e.target.closest('li[data-path]');return row?{path:row.dataset.path,element:row}:null;});
 }
 function startDrag(event,path){
  if(!ready()||!reorderableWebsiteLayer(model?.byPath.get(path)?.node)){event.preventDefault();return;}
  drag={from:path,token:crypto.randomUUID(),pin:stamp()};event.dataTransfer.setData(dragType,drag.token);event.dataTransfer.effectAllowed='move';
 }
 function endDrag(){removeMark();drag=null;}
 function removeMark(){if(marker)delete marker.dataset.layerDrop;marker=null;line?.remove();line=null;}
 function mark(from,to,position){
  const row=list?.querySelector('li[data-path="'+to.path+'"]');
  if(marker!==row&&marker)delete marker.dataset.layerDrop;
  marker=row;if(row)row.dataset.layerDrop=position;
  const frame=to.element.ownerDocument.defaultView.frameElement;
  if(!frame){line?.remove();line=null;return;}
  line??=node('div');line.className='website-layer-drop-guide';line.dataset.position=position;line.setAttribute('aria-hidden','true');
  const canvas=websiteFrameGeometry(frame),rect=to.element.getBoundingClientRect();
  const left=Math.max(canvas.clipLeft,canvas.left+rect.left*canvas.scale),right=Math.min(canvas.clipRight,canvas.left+rect.right*canvas.scale);
  const top=Math.max(canvas.clipTop,canvas.top+rect.top*canvas.scale),bottom=Math.min(canvas.clipBottom,canvas.top+rect.bottom*canvas.scale);
  Object.assign(line.style,{left:left+'px',top:(position==='after'?bottom:top)+'px',width:Math.max(0,right-left)+'px',height:(position==='inside'?Math.max(0,bottom-top):0)+'px'});
  line.dataset.hint=[model.byPath.get(from).label,t({before:'layerBefore',after:'layerAfter',inside:'layerInside'}[position]),model.byPath.get(to.path).label].join(' · ');
  if(!line.isConnected)root.ownerDocument.body.append(line);
 }
 function drops(host,targetAt){
  for(const type of ['dragover','drop'])host.addEventListener(type,event=>{
   if(!drag||!event.dataTransfer?.types.includes(dragType))return;
   event.preventDefault();const data=drag,to=targetAt(event);
   const position=dropPosition(data.from,to,event.clientY);
   if(type==='dragover'){
    event.dataTransfer.dropEffect=position?'move':'none';
    if(position)mark(data.from,to,position);else removeMark();
   }else{
    endDrag();
    if(position&&event.dataTransfer.getData(dragType)===data.token)dispatchMove(data.pin,data.from,to.path,position);
   }
  },{signal:hostEvents.signal});
  host.addEventListener('dragleave',event=>{if(!event.relatedTarget||!host.contains(event.relatedTarget))removeMark();},{signal:hostEvents.signal});
 }
 function dropPosition(from,to,clientY){
  if(!to||!model)return null;
  const a=model.byPath.get(from)?.node,b=model.byPath.get(to.path)?.node,rect=to.element.getBoundingClientRect();
  const y=(clientY-rect.top)/Math.max(1,rect.height),edge=y<0.5?'before':'after';
  return (y>0.23&&y<0.77?['inside',edge]:[edge]).find(p=>websiteLayerMove(a,b,p));
 }
 function canvasTarget(element){
  for(let n=element;n?.nodeType===1&&n!==n.ownerDocument.body;n=n.parentElement){
   const path=layerPath(n);if(model?.byPath.has(path))return {path,element:n};
  }
  return null;
 }
 function bindCanvas(doc){
  bindKeys(doc);drops(doc,event=>canvasTarget(event.target));
 }
 // Native drags originating inside a sandboxed, contenteditable frame can be
 // cancelled by Chromium. Capture the actual pointer on the authoring grip;
 // keep the public document and its iframe sandbox unchanged.
 function bindGrip(grip,section,signal){
  const doc=grip.ownerDocument,win=doc.defaultView,frame=win.frameElement;
  let pointer=null,moved=false,tick=0;
  const listen=(type,handler)=>grip.addEventListener(type,handler,{signal});
  function target(){
   const {x,y}=pointer,rect=websiteFrameGeometry(frame),hostX=rect.left+x*rect.scale,hostY=rect.top+y*rect.scale;
   const hit=root.ownerDocument.elementFromPoint(hostX,hostY);
   if(hit===frame)return {to:canvasTarget(doc.elementFromPoint(x,y)),y,scroller:doc.scrollingElement,top:(rect.clipTop-rect.top)/rect.scale,bottom:(rect.clipBottom-rect.top)/rect.scale};
   const row=hit?.closest('li[data-path]');
   if(row&&list.contains(row)){const scroller=list.closest('aside'),bounds=scroller.getBoundingClientRect();return {to:{path:row.dataset.path,element:row},y:hostY,scroller,top:bounds.top,bottom:bounds.bottom};}
   return {to:null};
  }
  function paint(){
   tick=0;if(!pointer||!moved)return;
   const {to,y,scroller,top,bottom}=target(),position=dropPosition(pointer.from,to,y);
   if(position)mark(pointer.from,to,position);else removeMark();
   if(scroller){const last=scroller.scrollTop;
    if(y<top+26)scroller.scrollTop-=12;else if(y>bottom-26)scroller.scrollTop+=12;
    if(last!==scroller.scrollTop)tick=win.requestAnimationFrame(paint);
   }
  }
  function stop(){const id=pointer?.id;pointer=null;if(tick)win.cancelAnimationFrame(tick);tick=0;grip.parentElement.classList.remove('moving');removeMark();if(id!=null&&grip.hasPointerCapture(id))grip.releasePointerCapture(id);}
  listen('pointerdown',event=>{
   const node=section();if(event.button!==0||!event.isPrimary||!ready()||!reorderableWebsiteLayer(node))return;
   event.preventDefault();moved=false;pointer={id:event.pointerId,from:layerPath(node),pin:stamp(),originX:event.clientX,originY:event.clientY,x:event.clientX,y:event.clientY};
   grip.setPointerCapture(event.pointerId);
  });
  listen('pointermove',event=>{
   if(pointer?.id!==event.pointerId)return;pointer.x=event.clientX;pointer.y=event.clientY;
   if(!moved&&Math.hypot(pointer.x-pointer.originX,pointer.y-pointer.originY)<4)return;
   moved=true;grip.parentElement.classList.add('moving');if(!tick)tick=win.requestAnimationFrame(paint);
  });
  listen('pointerup',event=>{
   if(pointer?.id!==event.pointerId)return;
   pointer.x=event.clientX;pointer.y=event.clientY;const data=pointer,{to,y}=target(),position=moved&&dropPosition(data.from,to,y);stop();
   if(position)dispatchMove(data.pin,data.from,to.path,position);
  });
  listen('lostpointercapture',stop);listen('pointercancel',stop);
  listen('click',event=>{if(!moved||event.detail===0){const node=section();if(node)openFinder(layerPath(node));}moved=false;});
  const escape=event=>{if(pointer&&event.key==='Escape'){event.preventDefault();moved=true;stop();}};
  doc.addEventListener('keydown',escape,{signal});root.ownerDocument.addEventListener('keydown',escape,{signal});
  signal.addEventListener('abort',stop,{once:true});
 }
 const canvasDrag={canMove:reorderableWebsiteLayer,bindGrip};
 return {bindHost,bindKeys,bindCanvas,bindList,paint,selection,reset,canvasDrag};
}
