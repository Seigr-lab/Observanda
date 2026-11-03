import {websiteCSSByteLimit} from './website-css-urls.js';
export const layoutProtected='[data-observanda-source],[data-observanda-part],[data-observanda-link],[data-observanda-editor],[data-website-instance],[data-website-feed],[data-website-menu],[data-website-source-gallery],[data-image-gallery],[data-website-recording]';
const container='main,section,article,aside,header,footer,div,figure';
const areaPattern=/^owarea-[a-f0-9-]{36}$/;
function childName(node){
 const label=node.getAttribute('aria-label')||node.getAttribute('alt');if(label)return label.slice(0,100);
 const source=node.querySelector(':scope > figcaption,:scope > h1,:scope > h2,:scope > h3')??node;
 const walker=node.ownerDocument.createTreeWalker(source,4);let text='',leaf;
 while(text.length<100&&(leaf=walker.nextNode()))if(!leaf.parentElement.closest('script,style,[hidden],[data-observanda-editor]'))text+=(leaf.nodeValue??'').slice(0,100-text.length);
 return text.trim().replace(/\s+/g,' ')||node.localName;
}

export function websiteLayoutComposer({panel,before,document,make,listen,t,selected,selectNode,styles,applyNodes,breakpoint,signal}){
 const root=make('section');root.className='website-layout-composer';panel.insertBefore(root,before);
 const label=(parent,key,control)=>{const node=make('label');node.append(make('span',t(key)),control);parent.append(node);return control;};
 const number=(parent,key,value,{min,step='1'}={})=>{const n=make('input');n.type='number';n.step=step;n.required=true;if(min!==undefined)n.min=String(min);n.value=String(value);return label(parent,key,n);};
 const choose=(parent,key,choices)=>{const s=make('select');for(const [value,name] of choices){const o=make('option',t(name));o.value=value;s.append(o);}return label(parent,key,s);};
 const button=(parent,key,fn)=>{const b=make('button',t(key));b.type='button';listen(b,'click',fn);parent.append(b);return b;};
 const group=(key,parent=root)=>{const d=make('details');d.append(make('summary',t(key)));parent.append(d);return d;};
 const grid=group('layoutCompose'),controls=make('div');controls.className='website-visual-fields';grid.append(controls);
 const arrangement=choose(controls,'layoutArrangement',[['tiles','layoutTiles'],['columns','layoutGrid'],['row','layoutRow'],['stack','layoutColumn']]);
 const columnCount=number(controls,'layoutColumns',2,{min:1}),tileWidth=number(controls,'layoutTileWidth',240,{min:1}),gap=number(controls,'layoutGapPx',16,{min:0});
 function arrangeFields(){columnCount.parentElement.hidden=arrangement.value!=='columns';tileWidth.parentElement.hidden=arrangement.value!=='tiles';}
 listen(arrangement,'change',arrangeFields);arrangeFields();
 const valid=controls=>controls.every(control=>control.reportValidity());
 const report=make('p');report.setAttribute('role','status');root.append(report);
 button(grid,'layoutApplyArrangement',()=>{
  const target=selected(),mode=arrangement.value;
  if(!target?.matches(container)||!valid([gap,...(mode==='tiles'?[tileWidth]:mode==='columns'?[columnCount]:[])]))return;
  const flex=mode==='row'||mode==='stack';
  const changes=[{node:target,properties:{display:flex?'flex':'grid',gap:gap.value+'px','grid-template-columns':flex?null:mode==='tiles'?'repeat(auto-fit, minmax(min(100%, '+tileWidth.value+'px), 1fr))':'repeat('+columnCount.value+', minmax(0, 1fr))','grid-template-areas':'none','flex-direction':flex?(mode==='row'?'row':'column'):null,'flex-wrap':mode==='row'?'wrap':null}}];
  for(const node of target.children)if(!node.closest(layoutProtected)&&areaPattern.test(document.defaultView.getComputedStyle(node).gridArea.split('/')[0].trim()))changes.push({node,properties:{'grid-area':'auto'}});
  report.textContent=t(applyNodes(changes)?'layoutApplied':'layoutAreaSize');
 });
 const areas=group('layoutAreas',grid),areaHelp=make('p',t('layoutAreasHint')),areaControls=make('div');areaControls.className='website-visual-fields';areas.append(areaHelp,areaControls);
 const columns=number(areaControls,'layoutColumns',2,{min:1}),rowsView=make('div');areas.append(rowsView);
 const nav=make('div');nav.className='website-visual-actions';areas.append(nav);
 const previous=button(nav,'pageBack',()=>{start-=20;drawRows();}),pageNo=make('span');nav.append(pageNo);const next=button(nav,'pageForward',()=>{start+=20;drawRows();});
 let rows=[],start=0,lastNode=null,lastView=null,point=null;
 const areaApply=button(areas,'layoutApplyAreas',()=>{
  if(!rows.length||!valid([columns]))return;
  const total=columns.valueAsNumber;
  // Do not allocate a CSS track list beyond the saved stylesheet's input budget.
  const maxChars=websiteCSSByteLimit;if(!Number.isSafeInteger(total)||total>maxChars/2){report.textContent=t('layoutAreaSize');return;}
  let line=[],used=0,size=0;const matrix=[],changes=[];
  function finish(){
   if(!used)return true;
   const missing=total-used;
   size+=missing*2+3;if(size>maxChars)return false;
   matrix.push('"'+line.join(' ')+(missing?' .'.repeat(missing):'')+'"');line=[];used=0;return true;
  }
  for(const row of rows){
   if(!Number.isSafeInteger(row.span)||row.span<1||row.span>total){report.textContent=t('layoutAreaSpanError');return;}
   if((row.break||used+row.span>total)&&!finish()){report.textContent=t('layoutAreaSize');return;}
   size+=row.span*(row.name.length+1);if(size>maxChars){report.textContent=t('layoutAreaSize');return;}
   line.push((row.name+' ').repeat(row.span).trimEnd());used+=row.span;
   changes.push({node:row.node,properties:{'grid-area':row.name}});
  }
  if(!finish()){report.textContent=t('layoutAreaSize');return;}
  changes.push({node:lastNode,properties:{display:'grid','grid-template-columns':'repeat('+total+', minmax(0, 1fr))','grid-template-areas':matrix.join(' ')}});
  if(applyNodes(changes)){report.textContent=t('layoutApplied');readAreas();}else report.textContent=t('layoutAreaSize');
 });
 function readAreas(){
  start=0;rows=[];if(root.hidden||!lastNode?.matches(container)||!areas.open)return;
  const read=styles(),style=read(lastNode),saved=[...style.gridTemplateAreas.matchAll(/"([^"]+)"/g)].map(m=>m[1].trim().split(/\s+/));
  const positions=new Map();for(const [y,line] of saved.entries())for(const token of line){if(!areaPattern.test(token))continue;const p=positions.get(token)??{y,span:0};p.span++;positions.set(token,p);}
  const count=/^repeat\((\d+),/.exec(style.gridTemplateColumns)?.[1];if(count)columns.value=count;
  let prior=-1;
  for(const node of lastNode.children){
   if(node.matches('script,style,template,[hidden]'))continue;
   if(node.matches(layoutProtected)){rows=[];break;}
   const name=read(node).gridArea.split('/')[0].trim(),p=positions.get(name);
   rows.push({node,name:areaPattern.test(name)?name:'owarea-'+crypto.randomUUID(),span:p?.span??1,break:prior>=0&&p?.y>prior});if(p)prior=p.y;
  }
  drawRows();
 }
 function drawRows(){
  rowsView.replaceChildren();areaApply.disabled=!rows.length;nav.hidden=rows.length<=20;
  previous.disabled=start===0;next.disabled=start+20>=rows.length;
  if(!rows.length){rowsView.append(make('p',t('layoutAreaUnavailable')));return;}
  pageNo.textContent=t('pageRange',{start:start+1,end:Math.min(rows.length,start+20),total:rows.length});
  for(const row of rows.slice(start,start+20)){
   const line=make('div');line.className='website-area-row';line.append(make('strong',childName(row.node)));rowsView.append(line);
   const span=number(line,'layoutSpan',row.span,{min:1});span.oninput=()=>{row.span=span.valueAsNumber;};
   const br=make('input');br.type='checkbox';br.checked=row.break;label(line,'layoutNewRow',br);br.onchange=()=>{row.break=br.checked;};
  }
 }
 listen(areas,'toggle',readAreas);
 const annotation=group('layoutAddAnnotation'),content=make('input');content.required=true;label(annotation,'layoutAnnotationText',content);
 button(annotation,'layoutAddAnnotation',()=>{
  const parent=selected();if(!parent?.matches(container)||parent.closest(layoutProtected)||!content.reportValidity()||!content.value.trim())return;
  const marker=document.createElement('p');marker.dataset.websiteAnnotation='';marker.textContent=content.value.trim();
  const changes=[{node:marker,properties:{position:'absolute',left:'50%',top:'50%','z-index':'1',margin:'0',padding:'.15em .4em','background-color':'Canvas',color:'CanvasText'}}];
  if(document.defaultView.getComputedStyle(parent).position==='static')changes.unshift({node:parent,properties:{position:'relative'}});
  const last=parent.lastElementChild,beforeCaption=parent.localName==='figure'&&last?.localName==='figcaption'?last:null;
  if(applyNodes(changes,()=>parent.insertBefore(marker,beforeCaption))){content.value='';selectNode(marker);coords.open=true;report.textContent=t('layoutApplied');}else report.textContent=t('layoutAreaSize');
 });
 const coords=group('layoutCoordinate'),note=make('p',t('layoutCoordinateHint')),fields=make('div');fields.className='website-visual-fields';coords.append(note,fields);
 const corner=choose(fields,'layoutAnchor',[['tl','layoutTopLeft'],['tr','layoutTopRight'],['bl','layoutBottomLeft'],['br','layoutBottomRight']]);
 const units=choose(fields,'layoutUnit',[['%','layoutPercent'],['px','layoutPixels']]),x=number(fields,'layoutX',0,{step:'any'}),y=number(fields,'layoutY',0,{step:'any'}),z=number(fields,'layoutZ',1);
 const actions=make('div');actions.className='website-visual-actions';coords.append(actions);
 function place(clear=false){
  const node=selected(),parent=node?.parentElement;if(!parent?.matches(container)||node.closest(layoutProtected)||!clear&&!valid([x,y,z]))return;
  const changes=[],props={position:'static',left:'auto',right:'auto',top:'auto',bottom:'auto','z-index':'auto'};
  if(!clear){
   if(document.defaultView.getComputedStyle(parent).position==='static')changes.push({node:parent,properties:{position:'relative'}});
   props.position='absolute';props[corner.value.endsWith('l')?'left':'right']=x.value+units.value;props[corner.value.startsWith('t')?'top':'bottom']=y.value+units.value;props['z-index']=z.value;
  }
  changes.push({node,properties:props});report.textContent=t(applyNodes(changes)?'layoutApplied':'layoutAreaSize');
 }
 button(actions,'layoutApplyPosition',()=>place());button(actions,'layoutPlacePoint',()=>{
  stopPoint();const node=selected(),parent=node?.parentElement;if(!parent?.matches(container)||node.closest(layoutProtected))return;
  point=new document.defaultView.AbortController();const signal=point.signal;
  report.textContent=t('layoutPointHint');const cursor=document.createElement('style');cursor.dataset.observandaEditor='';cursor.textContent='body,body *{cursor:crosshair!important}';document.head.append(cursor);
  signal.addEventListener('abort',()=>cursor.remove(),{once:true});
  document.addEventListener('click',event=>{
   event.preventDefault();event.stopImmediatePropagation();if(!parent.contains(event.target))return;
   const box=parent.getBoundingClientRect();if(!box.width||!box.height||!parent.clientWidth||!parent.clientHeight)return;
   for(let p=parent;p;p=p.parentElement){
    const style=document.defaultView.getComputedStyle(p);
    if(style.transform!=='none'){
     const m=new document.defaultView.DOMMatrixReadOnly(style.transform);
     if(!m.is2D||m.b!==0||m.c!==0||m.a<=0||m.d<=0){stopPoint();report.textContent=t('layoutPointTransform');return;}
    }
    if(style.rotate&&style.rotate!=='none'){stopPoint();report.textContent=t('layoutPointTransform');return;}
   }
   const left=(event.clientX-box.left)*parent.offsetWidth/box.width-parent.clientLeft+parent.scrollLeft;
   const top=(event.clientY-box.top)*parent.offsetHeight/box.height-parent.clientTop+parent.scrollTop;
   const value=(n,length,reverse)=>String(Math.round((reverse?length-n:n)*(units.value==='%'?100/Math.max(1,length):1)*100)/100);
   x.value=value(left,parent.clientWidth,corner.value.endsWith('r'));y.value=value(top,parent.clientHeight,corner.value.startsWith('b'));
   stopPoint();place();
  },{capture:true,signal});
  const cancel=event=>{if(event.key==='Escape'){event.preventDefault();stopPoint();report.textContent='';}};
  for(const doc of [document,root.ownerDocument])doc.addEventListener('keydown',cancel,{capture:true,signal});
 });
 button(actions,'layoutFlowAgain',()=>place(true));
 function stopPoint(){point?.abort();point=null;}
 signal?.addEventListener('abort',stopPoint,{once:true});
 function readPosition(){
  if(root.hidden||!lastNode||!coords.open)return;
  const s=styles()(lastNode),right=Boolean(s.right)&&s.right!=='auto',bottom=Boolean(s.bottom)&&s.bottom!=='auto',a=right?s.right:s.left,b=bottom?s.bottom:s.top;
  corner.value=(bottom?'b':'t')+(right?'r':'l');units.value=(a||b).endsWith('%')?'%':'px';
  const zIndex=document.defaultView.getComputedStyle(lastNode).zIndex;z.value=zIndex==='auto'?'1':zIndex;reflectOffsets();
 }
 function reflectOffsets(){
  if(!lastNode?.parentElement)return;
  const parent=lastNode.parentElement,computed=document.defaultView.getComputedStyle(lastNode);
  const right=corner.value.endsWith('r'),bottom=corner.value.startsWith('b'),rect=lastNode.getBoundingClientRect(),box=parent.getBoundingClientRect();
  const left=(rect.left-box.left)*parent.offsetWidth/(box.width||1)-parent.clientLeft+parent.scrollLeft,top=(rect.top-box.top)*parent.offsetHeight/(box.height||1)-parent.clientTop+parent.scrollTop;
  const value=(declared,fallback,length)=>{const n=parseFloat(declared),pixels=Number.isFinite(n)?n:fallback;return String(Math.round(pixels*(units.value==='%'?100/Math.max(1,length):1)*100)/100);};
  x.value=value(right?computed.right:computed.left,right?parent.clientWidth-left-lastNode.offsetWidth:left,parent.clientWidth);
  y.value=value(bottom?computed.bottom:computed.top,bottom?parent.clientHeight-top-lastNode.offsetHeight:top,parent.clientHeight);
 }
 listen(corner,'change',reflectOffsets);listen(units,'change',reflectOffsets);
 listen(coords,'toggle',readPosition);
 function refresh(){
  const node=selected(),view=breakpoint();root.hidden=!node||Boolean(node.closest(layoutProtected));
  grid.hidden=annotation.hidden=!node?.matches(container);coords.hidden=!node?.parentElement?.matches(container)||['header','footer','main','nav'].includes(node?.localName);
  if(node!==lastNode||view!==lastView){stopPoint();lastNode=node;lastView=view;report.textContent='';if(areas.open)readAreas();if(coords.open)readPosition();}
 }
 return {refresh};
}
