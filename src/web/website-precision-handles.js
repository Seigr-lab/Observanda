import {precisionPlane,precisionEdit,precisionNeighbours} from './website-precision-geometry.js';

const actions={width:'layoutWidth',height:'precisionHeight',padding:'sectionPadding',gap:'layoutGapPx',move:'precisionMove'};
export function precisionHandles({document,selection,settings,commit,report,t,signal}){
 const win=document.defaultView,host=document.createElement('div');
 host.dataset.observandaEditor='precision';host.contentEditable='false';
 host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;';
 const shadow=host.attachShadow({mode:'open'}),css=document.createElement('style');
 css.textContent=':host{font:12px/1.3 system-ui}*{box-sizing:border-box}.outline,.guide,.measure{position:fixed;pointer-events:none}.outline{border:1px solid #225bba}.guide{border:0 dashed #9743be}.vertical{border-left-width:1px}.horizontal{border-top-width:1px}.measure{background:#19366b;color:white;padding:2px 6px;border-radius:3px}button{position:fixed;pointer-events:auto;touch-action:none;border:1px solid #17366d;background:white;color:#17366d;padding:0;width:18px;height:18px;border-radius:3px;font:600 12px/1 system-ui;transform:translate(-50%,-50%)}button:focus-visible{outline:3px solid Highlight;outline-offset:1px}';
 shadow.append(css);
 const make=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;shadow.append(node);return node;};
 const outlines=[],controls=new Map(),vertical=make('div','guide vertical'),horizontal=make('div','guide horizontal'),measure=make('output','measure');
 const guides=[vertical,horizontal,measure];for(const g of guides)g.hidden=true;
 const place=(node,x,y)=>Object.assign(node.style,{left:x+'px',top:y+'px'});
 const dimensions=(el,rect)=>{place(el,rect.left,rect.top);el.style.width=rect.width+'px';el.style.height=rect.height+'px';};
 let drag=null,tick=0,current=[];
 const observed=new Set(),visibleNodes=new Set();
 const observer=new win.IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting&&observed.has(entry.target))visibleNodes.add(entry.target);else visibleNodes.delete(entry.target);
  schedule();
 });
 function sync(){
  current=selection();const next=new Set(current);
  for(const node of observed)if(!next.has(node)){observer.unobserve(node);observed.delete(node);visibleNodes.delete(node);}
  for(const node of next)if(!observed.has(node)){observed.add(node);observer.observe(node);}
  schedule();
 }
 function reset(){
  const old=drag;drag=null;
  if(old?.button.hasPointerCapture(old.pointer))old.button.releasePointerCapture(old.pointer);
  for(const el of guides)el.hidden=true;
 }
 function startValue(plane,kind){
  if(kind==='move')return [plane.x,plane.y];
  const value=kind==='width'||kind==='height'?plane.rect[kind]:parseFloat(plane.style[kind==='padding'?'paddingLeft':'columnGap']);
  return [Number.isFinite(value)?value:0];
 }
 function result(kind,plane,initial,dx,dy,snapping,neighbours){
  const values=kind==='move'?[initial[0]+dx,initial[1]+dy]:[initial[0]+(kind==='height'||kind==='gap'?dy:dx)];
  return precisionEdit(plane,kind,values,{...settings(),snapTo:snapping&&settings().snapTo,neighbours});
 }
 function paintDrag(data){
  if(data.reason){for(const el of guides)el.hidden=true;report(data.reason);return;}
  const {plane,kind}=drag,container=plane.parent.getBoundingClientRect(),rect=plane.rect;
  const x=kind==='move'?rect.left+data.x-plane.x:kind==='width'?rect.left+data.amount:kind==='padding'?rect.left+data.amount:rect.right;
  const y=kind==='move'?rect.top+data.y-plane.y:kind==='height'||kind==='gap'?rect.top+data.amount:rect.top;
  measure.textContent=kind==='move'?Math.round(data.x)+', '+Math.round(data.y)+' px':Math.round(data.amount)+' px';
  place(measure,Math.max(0,Math.min(win.innerWidth-90,x+5)),Math.max(0,Math.min(win.innerHeight-23,y+5)));measure.hidden=false;
  dimensions(vertical,{left:x,top:container.top,width:1,height:container.height});vertical.hidden=kind!=='width'&&kind!=='padding'&&!data.guideX;
  dimensions(horizontal,{left:container.left,top:y,width:container.width,height:1});horizontal.hidden=kind!=='height'&&kind!=='gap'&&!data.guideY;
 }
 const elements={width:'↔',height:'↕',padding:'⇥',gap:'↕',move:'✥'};
 for(const [kind,key] of Object.entries(actions)){
  const button=make('button','');button.type='button';button.setAttribute('aria-label',t(key));button.title=t(key);button.textContent=elements[kind];button.dataset.precisionHandle=kind;controls.set(kind,button);
  button.addEventListener('pointerdown',event=>{
   const [node]=current;if(!node||drag||event.button!==0)return;
   const plane=precisionPlane(node);if(plane.reason){report(plane.reason);return;}
   event.preventDefault();event.stopPropagation();button.focus({preventScroll:true});button.setPointerCapture(event.pointerId);
   drag={plane,kind,button,pointer:event.pointerId,begin:startValue(plane,kind),neighbours:plane.absolute&&['move','width','height'].includes(kind)?precisionNeighbours(plane):undefined,x:event.clientX,y:event.clientY,scope:settings().scope};
  },{signal});
  button.addEventListener('pointermove',event=>{
   if(drag?.pointer!==event.pointerId)return;
   paintDrag(result(kind,drag.plane,drag.begin,event.clientX-drag.x,event.clientY-drag.y,true,drag.neighbours));
  },{signal});
  button.addEventListener('pointerup',event=>{
   if(drag?.pointer!==event.pointerId)return;
   const prior=drag;reset();
   if(prior.scope!==settings().scope||!prior.plane.node.isConnected||prior.plane.node!==current[0])return;
   const dx=event.clientX-prior.x,dy=event.clientY-prior.y;if(Math.hypot(dx,dy)<2)return;
   const plane=precisionPlane(prior.plane.node);
   if(plane.reason){report(plane.reason);return;}
   const update=result(kind,plane,startValue(plane,kind),dx,dy,true);
   if(update.reason)report(update.reason);else commit([{node:plane.node,properties:update.properties}]);
  },{signal});
  for(const event of ['pointercancel','lostpointercapture'])button.addEventListener(event,reset,{signal});
  button.addEventListener('keydown',event=>{
   if(event.key==='Escape'){reset();return;}
   if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
   event.preventDefault();event.stopPropagation();const [node]=current;if(!node)return;
   const p=precisionPlane(node);if(p.reason){report(p.reason);return;}
   const delta=(event.shiftKey?settings().step:1)*(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1);
   const vertical=event.key==='ArrowDown'||event.key==='ArrowUp';
   const dx=kind==='move'&&vertical?0:delta,dy=kind==='move'&&!vertical?0:delta;
   const update=result(kind,p,startValue(p,kind),dx,dy,false);
   if(update.reason)report(update.reason);else commit([{node,properties:update.properties}]);
  },{signal});
 }
 function paint(){
  tick=0;
  if(!current.length){reset();host.remove();return;}
  if(!host.isConnected)document.body.append(host);
  // Draw only visible selection outlines. The active item alone owns handles.
  let visible=0;
  for(const node of visibleNodes){
   const r=node.getBoundingClientRect();if(r.bottom<0||r.right<0||r.left>win.innerWidth||r.top>win.innerHeight)continue;
   const edge=outlines[visible]??(outlines[visible]=make('div','outline'));dimensions(edge,r);edge.hidden=false;visible++;
  }
  for(let i=visible;i<outlines.length;i++)outlines[i].hidden=true;
  const p=current.length===1&&visibleNodes.has(current[0])?precisionPlane(current[0]):null,single=p&&!p.reason;
  for(const [kind,button] of controls){
   button.hidden=!single||kind==='move'&&!p.absolute||kind==='gap'&&!p.style?.display.match(/grid|flex/);
   if(button.hidden)continue;
   const r=p.rect,x=kind==='width'?r.right:kind==='padding'?r.left+Math.min(18,r.width/4):kind==='move'?r.left:r.left+r.width/2;
   const y=kind==='height'?r.bottom:kind==='gap'?r.top+Math.min(r.height/3,24):kind==='move'?r.top:r.top+r.height/2;
   place(button,x,y);
  }
 }
 function schedule(){if(!tick)tick=win.requestAnimationFrame(paint);}
 win.addEventListener('resize',schedule,{signal});document.addEventListener('scroll',schedule,{capture:true,passive:true,signal});
 signal.addEventListener('abort',()=>{observer.disconnect();reset();if(tick)win.cancelAnimationFrame(tick);host.remove();},{once:true});
 return {schedule,sync,reset};
}
