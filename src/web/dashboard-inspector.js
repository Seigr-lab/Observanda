import './i18n/catalogues/dashboardEditors.js';
import {t} from './i18n/index.js';
import {workspaceViewportTop} from './shell-navigation.js';
import {providerFields} from './data-registry.js';
import {panelSpan} from './dashboard-model.js';
import {cardIcon} from './dashboard-cards.js';
const dt=(key,parameters)=>t('dashboardEditors',key,parameters);


// Provider-owned choices share one settings surface on every screen size.
export function cardInspector({panel,provider,items,loadedData,selected,title,context,tab,fieldGroup,esc,button,iconButton,choiceUI}) {
 const input=(key,label,value,type='text',extra='')=>`<label>${esc(label)}<input data-desk-property="${key}" data-id="${panel.id}" type="${type}" value="${esc(value)}" ${extra}></label>`;
 const sourceOptions=typeof provider?.settings==='function'?provider.settings(context,panel.options,panel,loadedData):provider?.settings??[];
 const options=sourceOptions.filter(s=>(s.tab??'content')===tab);
 const views=[{id:'summary',label:dt("summary")},...(provider?.views??[])];
 const fields=providerFields(provider??{},items);
 const presentation=views.length>1?`<label>${esc(dt("presentation"))}<select aria-label="${esc(dt("presentation"))}" data-desk-property="presentation" data-id="${panel.id}">${views.map(v=>`<option value="${v.id}" ${panel.presentation===v.id?'selected':''}>${esc(v.label)}</option>`).join('')}</select></label>`:'';
 const settingsHTML=options.map(s=>{
  if(s.type==='lookup')return choiceUI.view(s,panel,context);
  const value=panel.options[s.key]??panel.config[s.key]??s.default??'';
  const common=`data-desk-option="${esc(s.key)}" data-id="${panel.id}"`;
  if(s.type==='multi'){
   const chosen=Array.isArray(value)?value:[],choices=[...s.choices,...chosen.filter(id=>!s.choices.some(c=>c.value===id)).map(id=>({value:id,label:dt('selectionWithId',{id})}))];
   return `<fieldset class="desk-multi-choice"><legend>${esc(s.label)}</legend><div>${choices.map(c=>`<label><input type="checkbox" ${common} data-desk-choice="${esc(c.value)}" value="${esc(c.value)}" ${chosen.includes(c.value)?'checked':''}><span>${esc(c.label)}</span></label>`).join('')||`<p>${esc(dt("noChoices"))}</p>`}</div>${chosen.length?'':`<small>${esc(dt("nothingSelected"))}</small>`}</fieldset>`;
  }
  return `<label class="${s.compact?'is-compact':''} ${s.type==='checkbox'?'desk-check-option':''}">${s.type==='checkbox'?`<input ${common} aria-label="${esc(s.label)}" type="checkbox" ${value?'checked':''}><span>${esc(s.label)}</span>`:esc(s.label)+(s.type==='select'?`<select ${common} aria-label="${esc(s.label)}">${value&&!s.choices.some(c=>String(c.value)===String(value))?`<option value="${esc(value)}" selected>${esc(dt("unavailableSelection"))}</option>`:''}${s.choices.map(c=>`<option value="${esc(c.value)}" ${String(c.value)===String(value)?'selected':''}>${esc(c.label)}</option>`).join('')}</select>`:`<input ${common} aria-label="${esc(s.label)}" type="${['number','color'].includes(s.type)?s.type:'text'}" value="${esc(value)}" ${s.placeholder?'placeholder="'+esc(s.placeholder)+'"':''} ${s.min!==undefined?'min="'+s.min+'"':''} ${s.max!==undefined?'max="'+s.max+'"':''}>`)}${s.help?'<small>'+esc(s.help)+'</small>':''}</label>`;
 }).join('');
 let body='';
 if(tab==='content'){
  body=`${title!==provider?.label?`<p class="desk-inspector-source">${esc(provider?.label??dt("unavailableSource"))}</p>`:''}${input('count',provider?.pageSize?dt("itemsPerPage"):dt("itemsToShow"),Math.min(panel.count,provider?.pageSize??panel.count),'number','min="1" step="1"'+(provider?.pageSize?' max="'+provider.pageSize+'"':''))}
   ${panel.source?.key!==null&&panel.source?.key!==undefined?`<p class="desk-inspector-note">${esc(dt("pinnedItem"))}</p>`+button(esc(dt("chooseCollection")),'dashboard-unpin-item',`data-id="${panel.id}"`):''}
   ${presentation}<div class="desk-scope-fields">${settingsHTML}</div>`;
 }
 if(tab==='display'){
  const choices=fields.filter(f=>fieldGroup==='references'?f.technical:!f.technical);
  body=input('title',dt("cardTitle"),panel.config.title,'text',`maxlength="96" placeholder="${esc(title)}"`)+
   presentation+`<div class="desk-scope-fields">${settingsHTML}</div>`+
   `<fieldset class="desk-detail-fields"><legend>${esc(dt("visibleDetails"))}</legend>${fields.some(f=>f.technical)?`<label class="desk-field-group">${esc(dt("chooseDetails"))}<select aria-label="${esc(dt("chooseDetails"))}" data-desk-field-group><option value="details" ${fieldGroup==='details'?'selected':''}>${esc(dt("content"))}</option><option value="references" ${fieldGroup==='references'?'selected':''}>${esc(dt("referenceIdentifiers"))}</option></select></label>`:''}
   <div class="desk-field-choices">${choices.map(f=>`<label><input type="checkbox" data-desk-field="${esc(f.key)}" data-id="${panel.id}" ${selected.includes(f.key)?'checked':''}>${esc(f.label)}</label>`).join('')||`<p>${esc(dt("noFields"))}</p>`}</div></fieldset>
   ${button(esc(dt("resetDetails")),'dashboard-fields-reset',`data-id="${panel.id}"`)}`;
 }
 if(tab==='layout'){
  const width=panelSpan(panel.width);
  body=`<label>${esc(dt("cardWidth"))} <output data-desk-width-label>${Math.round(width/12*100)}%</output><input aria-label="${esc(dt("cardWidth"))}" data-desk-property="width" data-id="${panel.id}" type="range" min="3" max="12" step="1" value="${width}" aria-valuetext="${esc(dt("widthPercent",{percent:Math.round(width/12*100)}))}"></label>
   <p class="desk-inspector-note">${esc(dt("widthHelp"))}</p>
   ${button(esc(dt("fitHeight")),'dashboard-natural',`data-id="${panel.id}"`)}
   <div class="desk-config-actions">${button(esc(dt("duplicateCard")),'dashboard-copy',`data-id="${panel.id}"`)}</div>`;
 }
 return `<aside class="desk-inspector" popover="manual" role="dialog" aria-labelledby="desk-inspector-title"><header><div><small>${esc(dt("cardSettings"))}</small><h2 id="desk-inspector-title">${esc(title)}</h2></div><button type="button" class="desk-button desk-icon desk-inspector-move" aria-label="${esc(dt("moveSettings"))}" title="${esc(dt("moveSettingsHelp"))}">${cardIcon('grip')}</button>${iconButton('close',dt("closeSettings"),'dashboard-inspector-close')}</header>
  <nav class="desk-inspector-tabs" aria-label="${esc(dt("settingsSections"))}">${[['content',dt("content")],['display',dt("display")],['layout',dt("layout")]].map(([id,label])=>button(esc(label),'dashboard-inspector-tab',`data-tab="${id}" aria-pressed="${tab===id}"`)).join('')}</nav>
  <div class="desk-inspector-body">${body}</div>
 </aside>`;
}

// A top-layer tool window never participates in dashboard layout. In particular,
// mounting it must not change card widths, document overflow or scroll position.
// Position is view state only; changing tabs or fields retains it.
export function bindCardInspector(root,position={}) {
 if(!root)return ()=>{};
 const workspace=root.closest('.desk-workspace'),toolbar=workspace.querySelector('.desk-toolbar');
 const card=workspace.querySelector('.desk-card.is-selected'),controller=new AbortController(),options={signal:controller.signal};
 const body=root.querySelector('.desk-inspector-body'),header=root.querySelector('header');
 let frame=null,gesture=null;
 const clamp=(value,min,max)=>Math.max(min,Math.min(value,max));
 function bounds(){
  const viewport=window.visualViewport,box=workspace.getBoundingClientRect();
  const left=(viewport?.offsetLeft??0)+12,right=Math.min(box.right,(viewport?.offsetLeft??0)+(viewport?.width??document.documentElement.clientWidth)-12);
  const bottom=(viewport?.offsetTop??0)+(viewport?.height??innerHeight)-12;
  return {left:clamp(box.left,left,right-1),right,top:Math.min(bottom-1,Math.max((viewport?.offsetTop??0)+12,workspaceViewportTop(toolbar)+12)),bottom};
 }
 function place(){
  frame=null;if(!root.isConnected)return;
  const area=bounds(),compact=workspace.clientWidth<=600;
  root.dataset.compact=String(compact);
  root.style.width=(compact?area.right-area.left:Math.min(340,area.right-area.left))+'px';
  root.style.maxHeight=Math.max(1,area.bottom-area.top)+'px';
  const box=root.getBoundingClientRect();
  if(compact){
   position.left=area.left;position.top=area.top;
  }else if(position.card!==card?.dataset.deskCard||position.compact!==compact){
   position.card=card?.dataset.deskCard;
   const target=card?.getBoundingClientRect()??area;
   const cards=[...workspace.querySelectorAll('.desk-card')].map(node=>({node,box:node.getBoundingClientRect()}))
    .filter(({box:r})=>r.bottom>area.top&&r.top<area.bottom);
   // Consider nearby free space first, then gaps elsewhere in the viewport.
   const xs=new Set([target.right+16,target.left-box.width-16,target.left,target.right-box.width,area.left,area.right-box.width]);
   const ys=new Set([target.top,target.bottom+16,target.top-box.height-16,area.top,area.bottom-box.height]);
   for(const {box:r} of cards){xs.add(r.right+16);xs.add(r.left-box.width-16);ys.add(r.bottom+16);ys.add(r.top-box.height-16);}
   let best=null;
   for(const x of xs)for(const y of ys){
    const left=clamp(x,area.left,area.right-box.width),top=clamp(y,area.top,area.bottom-Math.min(220,area.bottom-area.top));
    // A taller form may scroll in free space below a card instead of covering it.
    const height=Math.min(box.height,area.bottom-top);
    const overlap=cards.reduce((sum,{node,box:r})=>sum+Math.max(0,Math.min(left+box.width,r.right)-Math.max(left,r.left))*Math.max(0,Math.min(top+height,r.bottom)-Math.max(top,r.top))*(node===card?10:1),0);
    const gapX=Math.max(target.left-left-box.width,left-target.right,0),gapY=Math.max(target.top-top-box.height,top-target.bottom,0);
    const distance=10*Math.hypot(gapX,gapY)+Math.abs(left-target.left)+Math.abs(top-target.top)+(box.height-height)*2;
    if(!best||overlap<best.overlap||overlap===best.overlap&&distance<best.distance)best={left,top,overlap,distance};
   }
   position.left=best.left;position.top=best.top;
  }
  position.compact=compact;
  position.left=clamp(position.left,area.left,area.right-box.width);
  // Preserve the tool window's origin across tabs. A long settings form uses
  // only the room beneath it; it cannot enlarge the page or push cards around.
  position.top=clamp(position.top,area.top,area.bottom-Math.min(220,area.bottom-area.top));
  root.style.maxHeight=(area.bottom-position.top)+'px';
  root.style.left=position.left+'px';root.style.top=position.top+'px';
 }
 const schedule=()=>{if(frame===null)frame=requestAnimationFrame(place);};
 root.showPopover();place();
 const observer=new ResizeObserver(schedule);observer.observe(root);observer.observe(workspace);
 window.addEventListener('resize',schedule,options);window.addEventListener('scroll',schedule,{...options,passive:true});
 window.visualViewport?.addEventListener('resize',schedule,options);
 window.visualViewport?.addEventListener('scroll',schedule,options);
 document.addEventListener('observanda:interface-layout',schedule,options);
 header.addEventListener('pointerdown',event=>{
  if(position.compact||event.button!==0||event.target.closest('[data-action]'))return;
  event.preventDefault();
  root.querySelector('.desk-inspector-move').focus({preventScroll:true});
  gesture={id:event.pointerId,x:event.clientX,y:event.clientY,left:position.left,top:position.top};
  header.setPointerCapture(event.pointerId);root.classList.add('is-moving');
 },options);
 header.addEventListener('pointermove',event=>{
  if(gesture?.id!==event.pointerId)return;
  position.left=gesture.left+event.clientX-gesture.x;position.top=gesture.top+event.clientY-gesture.y;place();
 },options);
 const release=()=>{gesture=null;root.classList.remove('is-moving');};
 header.addEventListener('pointerup',release,options);header.addEventListener('lostpointercapture',release,options);
 root.querySelector('.desk-inspector-move').addEventListener('keydown',event=>{
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!delta)return;
  event.preventDefault();event.stopPropagation();
  const step=event.shiftKey?40:10;position.left+=delta[0]*step;position.top+=delta[1]*step;place();
 },options);
 body.scrollTop=position.scrollTop??0;
 return ()=>{
  position.scrollTop=body.scrollTop;
  controller.abort();observer.disconnect();if(frame!==null)cancelAnimationFrame(frame);
  if(root.matches(':popover-open'))root.hidePopover();
 };
}
