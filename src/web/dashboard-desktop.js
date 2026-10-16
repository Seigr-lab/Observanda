import {workspaceViewportTop} from './shell-navigation.js';
import {panelSpan} from './dashboard-model.js';

// The order and preferred column are durable; pixel positions are derived from
// the current viewport and each card's actual content. No equal-height rows.
export function placeCards(cards,width,gap=16){
 const unit=(width+gap)/12,minimum=Math.min(12,Math.max(3,Math.ceil(250/unit)));
 const placed=[];
 for(const card of cards){
  const span=width<600?12:Math.min(12,Math.max(minimum,panelSpan(card.width)));
  const preferred=width<600?0:card.column===null?null:Math.min(card.column,12-span);
  let best=null;
  for(let column=0;column<=12-span;column++){
   if(preferred!==null&&column!==preferred)continue;
   const left=column*unit,right=left+span*unit-gap;
   const top=placed.reduce((top,item)=>left<item.left+item.width-1&&right>item.left+1?Math.max(top,item.top+item.height+gap):top,0);
   if(!best||top<best.top)best={id:card.id,column,span,left,top,width:span*unit-gap,height:card.height};
  }
  placed.push(best);
 }
 return placed;
}

export function dashboardDesktop({root,toolbar,sources=toolbar,add,move,resize,announce}){
 if(!root)return ()=>{};
 const doc=root.ownerDocument,win=doc.defaultView,controller=new AbortController(),options={signal:controller.signal};
 let frame=null,scrollFrame=null,gesture=null,positions=[];
 const cards=()=>[...root.querySelectorAll('[data-desk-card]')];
 function layout(){
  frame=null;if(!root.isConnected)return;
  const width=root.clientWidth,items=cards(),spec=items.map(node=>({id:node.dataset.deskCard,width:Number(node.dataset.span),column:node.dataset.column===''?null:Number(node.dataset.column),height:0}));
  const widths=placeCards(spec,width);
  items.forEach((node,i)=>{node.style.width=widths[i].width+'px';node.style.minHeight=Number(node.dataset.height)+'px';});
  spec.forEach((item,i)=>item.height=items[i].getBoundingClientRect().height);
  positions=placeCards(spec,width);
  positions.forEach((item,i)=>{items[i].style.left=item.left+'px';items[i].style.top=item.top+'px';});
  root.style.height=Math.max(230,...positions.map(p=>p.top+p.height))+'px';
  root.dataset.placed='true';
 }
 const schedule=()=>{if(frame===null)frame=win.requestAnimationFrame(layout);};
 const observer=new ResizeObserver(schedule);observer.observe(root);
 const measureToolbar=()=>{if(sources&&toolbar)sources.style.setProperty('--desk-toolbar-height',getComputedStyle(toolbar).position==='sticky'?toolbar.offsetHeight+'px':'0px');};
 const toolbarObserver=new ResizeObserver(measureToolbar);if(toolbar)toolbarObserver.observe(toolbar);measureToolbar();
cards().forEach(card=>observer.observe(card));
 const mutations=new MutationObserver(schedule);mutations.observe(root,{subtree:true,attributes:true,attributeFilter:['data-span','data-column','data-height']});
 doc.fonts?.ready.then(schedule);win.addEventListener('resize',schedule,options);layout();

 function locate(x,y){
  const box=root.getBoundingClientRect(),localX=x-box.left,localY=y-box.top;
  if(localX<0||localX>box.width||localY<0||localY>box.height+100)return null;
  const available=positions.filter(p=>p.id!==gesture.id),span=Math.min(12,gesture.span);
  const column=Math.max(0,Math.min(12-span,Math.round((localX-gesture.offset)/(box.width+16)*12)));
  if(!available.length)return {before:null,column,top:0};
  let closest=null,distance=Infinity;
  for(const p of available){
   const dx=localX<p.left?p.left-localX:localX>p.left+p.width?localX-p.left-p.width:0;
   const dy=localY<p.top?p.top-localY:localY>p.top+p.height?localY-p.top-p.height:0;
   if(Math.hypot(dx,dy)<distance){closest=p;distance=Math.hypot(dx,dy);}
  }
  const before=localY<closest.top+closest.height/2;
  return {before:before?closest.id:available[available.indexOf(closest)+1]?.id??null,column,top:before?closest.top:closest.top+closest.height+8};
 }
 function showTarget(){
  const g=gesture;if(!g||g.kind==='resize'||g.keyboard)return;
  g.target=locate(g.x,g.y);g.marker.hidden=!g.target;
  g.ghost.style.left=g.x+14+'px';g.ghost.style.top=g.y+14+'px';
  if(g.target){const unit=(root.clientWidth+16)/12;g.marker.style.left=g.target.column*unit+'px';g.marker.style.width=Math.min(root.clientWidth,g.span*unit-16)+'px';g.marker.style.top=g.target.top+'px';}
 }
 function scrolling(){
  if(!gesture?.started||gesture.keyboard){scrollFrame=null;return;}
  const top=workspaceViewportTop(toolbar);
  const delta=gesture.y<top+32?-12:gesture.y>win.innerHeight-56?12:0;
  if(delta)win.scrollBy(0,delta);showTarget();scrollFrame=win.requestAnimationFrame(scrolling);
 }
 function beginVisual(){
  const g=gesture;g.started=true;
  if(g.node)g.node.classList.add('desk-moving');
  if(g.kind==='resize')return;
  g.ghost=doc.createElement('div');g.ghost.className='desk-drag-ghost';g.ghost.textContent=g.label;doc.body.append(g.ghost);
  g.marker=doc.createElement('div');g.marker.className='desk-drop-marker';g.marker.hidden=true;root.append(g.marker);
  showTarget();scrollFrame=win.requestAnimationFrame(scrolling);
 }
 function end(apply){
  const g=gesture;if(!g)return;gesture=null;
  if(scrollFrame!==null)win.cancelAnimationFrame(scrollFrame);scrollFrame=null;
  g.ghost?.remove();g.marker?.remove();g.node?.classList.remove('desk-moving');
  root.querySelectorAll('.desk-key-target').forEach(n=>n.classList.remove('desk-key-target'));
  if(g.started&&!g.keyboard){
   const suppress=e=>{e.preventDefault();e.stopImmediatePropagation();};
   doc.addEventListener('click',suppress,{capture:true,once:true});
   win.setTimeout(()=>doc.removeEventListener('click',suppress,true),0);
  }
  if(!apply||!g.started){if(g.kind==='resize'&&g.original){Object.assign(g.node.dataset,g.original);}schedule();if(g.started)announce('Move cancelled.');return;}
  if(g.kind==='resize'){resize(g.id,g.span,g.height);return;}
  if(g.target){
   if(g.kind==='add')add(g.tool,g.target.before,g.target.column,g.restore,g.workspaceId);
   else move(g.id,g.target.before,g.target.column);
  }else announce('Drop a card on the dashboard to place it.');
 }
 doc.addEventListener('pointerdown',event=>{
  const handle=event.target.closest('[data-desk-move],[data-desk-tool],[data-desk-resize]');
  if(!handle||event.button!==0||gesture||(!root.contains(handle)&&!sources?.contains(handle)))return;
  const node=handle.closest('[data-desk-card]'),rect=node?.getBoundingClientRect();
  const kind=handle.hasAttribute('data-desk-resize')?'resize':node?'move':'add';
  gesture={original:node?{span:node.dataset.span,height:node.dataset.height,column:node.dataset.column}:null,kind,node,id:node?.dataset.deskCard,tool:handle.dataset.deskTool,restore:handle.dataset.restore||null,workspaceId:handle.dataset.workspace||null,label:handle.dataset.label||node?.querySelector('h2').textContent||handle.textContent,
   span:node?Number(node.dataset.span):Number(handle.dataset.span??4),height:node?Number(node.dataset.height):0,column:node?.dataset.column===''?null:Number(node?.dataset.column??0),
   x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,offset:rect?Math.min(event.clientX-rect.left,rect.width/2):40,rect,pointer:event.pointerId,started:false};
  handle.setPointerCapture(event.pointerId);
 },options);
 doc.addEventListener('pointermove',event=>{
  const g=gesture;if(!g||g.pointer!==event.pointerId)return;
  g.x=event.clientX;g.y=event.clientY;
  if(!g.started&&Math.hypot(g.x-g.startX,g.y-g.startY)<6)return;
  event.preventDefault();if(!g.started)beginVisual();
  if(g.kind==='resize'){
   const unit=(root.clientWidth+16)/12;
   g.span=Math.max(3,Math.min(12,Math.round((g.rect.width+g.x-g.startX+16)/unit)));
   g.height=Math.abs(g.y-g.startY)>8?Math.max(0,Math.min(10000,Math.round(g.rect.height+g.y-g.startY))):Number(g.node.dataset.height);
   g.node.dataset.span=g.span;g.node.dataset.height=g.height;
   if(g.column!==null)g.node.dataset.column=Math.min(g.column,12-g.span);
   layout();
  }else showTarget();
 },{...options,passive:false});
 doc.addEventListener('pointerup',e=>{if(gesture?.pointer===e.pointerId)end(gesture.started);},options);
 doc.addEventListener('pointercancel',()=>end(false),options);
 doc.addEventListener('lostpointercapture',()=>{if(gesture)end(false);},options);
 doc.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&gesture){e.preventDefault();end(false);return;}
  const handle=e.target.closest('[data-desk-move],[data-desk-resize]');if(!handle||!root.contains(handle))return;
  const node=handle.closest('[data-desk-card]'),id=node.dataset.deskCard;
  if(e.key==='Escape'&&gesture){e.preventDefault();end(false);return;}
  if(handle.hasAttribute('data-desk-resize')){
   if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;
   e.preventDefault();const width=Number(node.dataset.span),height=Number(node.dataset.height);
   resize(id,Math.max(3,Math.min(12,width+(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0))),e.key==='Home'?0:['ArrowUp','ArrowDown'].includes(e.key)?Math.max(0,Math.min(10000,(height||node.offsetHeight)+(e.key==='ArrowUp'?-20:20))):height);return;
  }
  if([' ','Enter'].includes(e.key)){
   e.preventDefault();if(gesture){end(true);return;}
   const items=cards(),index=items.indexOf(node);
   gesture={kind:'move',keyboard:true,started:true,node,id,span:Number(node.dataset.span),index,target:{before:items[index+1]?.dataset.deskCard??null,column:Number(node.dataset.column||positions[index]?.column||0)}};
   node.classList.add('desk-moving');announce('Card picked up. Arrow keys move it; Enter places it; Escape cancels.');return;
  }
  if(gesture?.keyboard&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
   e.preventDefault();const g=gesture,items=cards().filter(n=>n.dataset.deskCard!==g.id);
   if(['ArrowLeft','ArrowRight'].includes(e.key))g.target.column=Math.max(0,Math.min(12-g.span,g.target.column+(e.key==='ArrowLeft'?-1:1)));
   else g.index=e.key==='Home'?0:e.key==='End'?items.length:Math.max(0,Math.min(items.length,g.index+(e.key==='ArrowUp'?-1:1)));
   g.target.before=items[g.index]?.dataset.deskCard??null;
   root.querySelectorAll('.desk-key-target').forEach(n=>n.classList.remove('desk-key-target'));items[g.index]?.classList.add('desk-key-target');
   announce('Position '+(g.index+1)+', column '+(g.target.column+1)+'.');
  }
 },options);
 return ()=>{end(false);controller.abort();observer.disconnect();toolbarObserver.disconnect();mutations.disconnect();if(frame!==null)win.cancelAnimationFrame(frame);};
}
