import {websiteLayerAt,movableWebsiteLayer,websiteLayerMove,layerPath,indexWebsiteLayers,foldLayerText} from './website-layer-model.js';
import {finderGroups,openWebsiteFinder} from './website-files-finder.js';
export {websiteLayerAt,movableWebsiteLayer,websiteLayerMove} from './website-layer-model.js';

const pageSize=48,dragType='application/x-observanda-website-layer';
export function websiteHierarchy({t,site,enabled,available,snapshot,read,edit,button,escape,openPage,selectLayer,retainSelection,notify}){
 let root,list,controls,model,chosen=null,query='',offset=0,expanded=new Set(),drag=null,marker,closeDialog,hostEvents;
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
   const {node,path,depth,label}=row,attr='data-path="'+escape(path)+'"',active=chosen===path,movable=movableWebsiteLayer(node);
   const toggle=row.branch?'<button type="button" class="website-layer-toggle" data-layer-toggle aria-label="'+escape(t(expanded.has(path)?'layerCollapse':'layerExpand'))+'" aria-expanded="'+String(!!query||expanded.has(path))+'" '+(query?'disabled':'')+'>'+((query||expanded.has(path))?'▾':'▸')+'</button>':'';
   const labelButton='<button class="website-layer-label" type="button" data-layer-select aria-pressed="'+String(active)+'">'+escape(label)+'</button>';
   let actions='';
   if(active){
    actions=button('sectionEdit','edit-block',attr);
    if(movable){
     actions+=actionButton('layerMove','move')+button('duplicate','duplicate',attr)+
      button('up','move-up',attr+(websiteLayerMove(node,node.previousElementSibling,'before')?'':' disabled'))+
      button('down','move-down',attr+(websiteLayerMove(node,node.nextElementSibling,'after')?'':' disabled'))+
      button('remove','remove',attr);
    }
   }
   return '<li '+attr+' data-level="'+Math.min(depth,3)+'" '+(active?'aria-current="true" ':'')+(movable?'draggable="true"':'')+
    '><span>'+toggle+labelButton+'</span>'+actions+'</li>';
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
  offset=Math.max(0,Math.floor(index/pageSize)*pageSize);draw();
 }
 function paint(host,doc){
  if(host!==list)bindList(host);
  model=indexWebsiteLayers(doc);draw();
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
   const moving=index.byPath.get(from);if(!movableWebsiteLayer(moving?.node))return;
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
  hostEvents=new AbortController();bindKeys(doc);
  const header=root.querySelector('header');if(!header)return;
  let trigger=header.querySelector('[data-website-finder]');
  if(!trigger){trigger=node('button',t('finderOpen'));trigger.type='button';trigger.dataset.websiteFinder='';trigger.className='button';trigger.setAttribute('aria-keyshortcuts','Control+K Meta+K');header.append(trigger);}
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
   else if(e.target.closest('[data-layer-move]'))openFinder(path);
  };
  host.ondragstart=e=>{
   const row=e.target.closest('li[draggable="true"]');if(!row||!ready())return;
   drag={from:row.dataset.path,token:crypto.randomUUID(),pin:stamp()};e.dataTransfer.setData(dragType,drag.token);e.dataTransfer.effectAllowed='move';
  };
  host.ondragend=()=>{removeMark();drag=null;};
  drops(host,e=>{const row=e.target.closest('li[data-path]');return row?{path:row.dataset.path,element:row}:null;});
 }
 function removeMark(){if(marker)delete marker.dataset.layerDrop;marker=null;}
 function drops(host,targetAt){
  for(const type of ['dragover','drop'])host.addEventListener(type,event=>{
   if(!drag||!event.dataTransfer?.types.includes(dragType))return;
   event.preventDefault();const data=drag,to=targetAt(event);
   let position;
   if(to&&model){
    const a=model.byPath.get(data.from)?.node,b=model.byPath.get(to.path)?.node,rect=to.element.getBoundingClientRect();
    const y=(event.clientY-rect.top)/Math.max(1,rect.height),edge=y<0.5?'before':'after';
    position=(y>0.23&&y<0.77?['inside',edge]:[edge]).find(p=>websiteLayerMove(a,b,p));
   }
   removeMark();
   if(type==='dragover'){
    event.dataTransfer.dropEffect=position?'move':'none';
    if(position){marker=list?.querySelector('li[data-path="'+to.path+'"]');if(marker)marker.dataset.layerDrop=position;}
   }else{
    drag=null;
    if(position&&event.dataTransfer.getData(dragType)===data.token)dispatchMove(data.pin,data.from,to.path,position);
   }
  },{signal:hostEvents.signal});
 }
 function bindCanvas(doc){
  bindKeys(doc);drops(doc,event=>{
   for(let n=event.target?.nodeType===1?event.target:event.target?.parentElement;n&&n!==doc.body;n=n.parentElement){
    const path=layerPath(n);if(model?.byPath.has(path))return {path,element:n};
   }
   return null;
  });
 }
 return {bindHost,bindKeys,bindCanvas,bindList,paint,selection,reset};
}
