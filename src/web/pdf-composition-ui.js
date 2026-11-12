import './i18n/catalogues/pdfEditor.js';
import {t} from './i18n/index.js';
import {pdfCompositionArea,pdfCompositionKey,pdfCompositionStatus,pdfCompositionDefaults,pdfAdjustComposition,pdfCompositionGeometry,validPdfCompositionBox} from './pdf-composition-model.js';
import {pdfCompositionProofView} from './pdf-composition-proof-view.js';
import {compositionDiagnostics} from './pdf-composition-diagnostics.js';
import {arrangeComposition,compositionMovement} from './pdf-composition-arrange.js';
const tr=(key,values)=>t('pdfEditor',key,values),fields=['xMm','yMm','widthMm','heightMm'];
function locate(node,box,area){
 Object.assign(node.style,{left:box.xMm/area.widthMm*100+'%',top:box.yMm/area.heightMm*100+'%',width:box.widthMm/area.widthMm*100+'%',height:box.heightMm/area.heightMm*100+'%'});
}
function ruler(size,axis){
 const step=size>400?100:size>120?50:size>50?20:10;
 const ticks=Array.from({length:Math.ceil(size/step)},(_,i)=>'<span style="'+(axis==='x'?'left':'top')+':'+(i*step/size*100)+'%">'+i*step+'</span>').join('');
 return '<div aria-hidden="true" class="pdf-composition-ruler ruler-'+axis+'">'+ticks+'</div>';
}
export function pdfCompositionUI({esc,getDocument,getSection,changed,draw,requestProof,isSaved,canPrint=()=>true,getPreflight,editObject,closeObject}){
 let selectedKey=null,context='',root=null,controller=null,gesture=null,disposed=false,blocked=false;
 const picked=new Set();let relative='selection',arrangement='horizontal-start';
 const proof=pdfCompositionProofView({request:requestProof,changed:refresh});
 const layout=()=>getSection()?.layout??getDocument()?.header.layout,key=()=>[getDocument()?.header.id,getSection()?.id].join(':'),current=()=>pdfCompositionStatus(getSection(),layout());
 const button=(label,command)=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="composition-'+command+'">'+esc(tr(label))+'</button>';
 const label=item=>{const kind=item.target.kind==='block'?tr('compositionBlock')+' '+(item.target.index+1):item.target.kind==='title'?tr('section'):tr('composition'+item.target.kind[0].toUpperCase()+item.target.kind.slice(1));return kind+(item.label?' - '+item.label.slice(0,160):'');};
 const issueText=status=>!status.ready?tr(status.issues.some(issue=>issue.code==='PDF_COMPOSITION_COLUMNS')?'compositionColumns':status.issues.some(issue=>issue.code==='PDF_COMPOSITION_BOUNDS')?'compositionBounds':'compositionStale'):status.issues.length?tr('compositionOverlap'):tr('compositionReady');
 function reset(){closeObject?.();controller?.abort();controller=null;gesture=null;root=null;selectedKey=null;picked.clear();proof.clear();context=key();}
 function oneColumn(){const section=getSection();section.layout={...structuredClone(layout()),columns:1};}
 function selectItem(id,{keep=false}={}){
  selectedKey=id;
  if(!keep||!picked.has(id)){picked.clear();picked.add(id);}
  const canvas=root?.querySelector('[data-pdf-composition-canvas]'),box=getSection()?.composition?.boxes.find(box=>pdfCompositionKey(box.target)===id);
  const selected=canvas?.querySelector('[data-pdf-composition-box="'+id+'"]');
  if(!selected||!box){draw();return;}
  const handle=selected.firstElementChild;
  const resize=canvas.querySelector('[data-pdf-composition-resize]');
  if(resize){resize.dataset.pdfCompositionResize=id;resize.setAttribute('aria-label',tr('compositionResize')+' '+handle.title);if(resize.parentElement!==selected)selected.append(resize);}
  root.querySelector('[data-pdf-composition-select]').value=id;
  for(const field of root.querySelectorAll('[data-pdf-composition-field]')){
   field.dataset.pdfCompositionKey=id;field.value=String(box[field.dataset.pdfCompositionField]);field.removeAttribute('aria-invalid');
  }
  refresh();
 }
 function arrangeFields(items){
  const option=(value,key,current)=>'<option value="'+value+'"'+(value===current?' selected':'')+'>'+esc(tr(key))+'</option>';
  const positions=[['horizontal-start','compositionAlignLeft'],['horizontal-middle','compositionAlignCenter'],['horizontal-end','compositionAlignRight'],['vertical-start','compositionAlignTop'],['vertical-middle','compositionAlignMiddle'],['vertical-end','compositionAlignBottom'],['horizontal-distribute','compositionSpaceAcross'],['vertical-distribute','compositionSpaceDown']];
  return '<details class="pdf-arrange"><summary>'+esc(tr('compositionArrange'))+'</summary><label class="field">'+esc(tr('compositionSelection'))+'<select multiple size="5" data-pdf-arrange-items>'+items.filter(item=>item.box).map(item=>'<option value="'+esc(item.key)+'"'+(picked.has(item.key)?' selected':'')+'>'+esc(label(item))+'</option>').join('')+'</select></label><div class="pdf-toolbar"><label>'+esc(tr('compositionAlignTo'))+'<select data-pdf-arrange-relative>'+option('selection','compositionSelection',relative)+option('page','compositionPrintedArea',relative)+'</select></label><label>'+esc(tr('compositionArrangement'))+'<select data-pdf-arrange-position>'+positions.map(([id,key])=>option(id,key,arrangement)).join('')+'</select></label>'+button('compositionApplyArrange','arrange')+'</div></details>';
 }
 function view(){
  if(context!==key())reset();const section=getSection();if(!section)return '';const value=section.composition;
  let html='<details data-pdf-composition-editor'+(blocked?' hidden':'')+(value?' open':'')+'><summary>'+esc(tr('compositionTitle'))+'</summary><p>'+esc(tr('compositionIntro'))+'</p><label class="field">'+esc(tr('compositionMode'))+'<select data-pdf-composition-mode><option value="flow"'+(!value?' selected':'')+'>'+esc(tr('compositionFlow'))+'</option><option value="page"'+(value?' selected':'')+'>'+esc(tr('compositionPage'))+'</option></select></label>';
  if(!value)return html+'</details>';const status=current(),items=status.items,area=pdfCompositionArea(layout());if(!items.some(item=>item.key===selectedKey))selectedKey=items[0]?.key??null;
  const eligible=new Set(items.filter(item=>item.box).map(item=>item.key));for(const id of picked)if(!eligible.has(id))picked.delete(id);if(!picked.size&&eligible.has(selectedKey))picked.add(selectedKey);
  html+='<p role="status" data-pdf-composition-status>'+esc(issueText(status))+'</p><div class="pdf-toolbar">'+button('compositionAdjust','adjust')+'</div><label class="field">'+esc(tr('compositionGrid'))+'<input type="number" min="0" max="50" step="any" data-pdf-composition-grid value="'+value.gridMm+'"></label><label><input type="checkbox" data-pdf-composition-snap'+(value.snap?' checked':'')+'>'+esc(tr('compositionSnap'))+'</label>';
  if(area){const help='pdf-composition-help-'+section.id;
   html+='<p id="'+help+'">'+esc(tr('compositionHelp'))+'</p><p data-pdf-proof-status role="status"></p><div hidden data-pdf-proof-retry>'+button('retry','proof-retry')+'</div><div class="pdf-composition-frame">'+ruler(area.widthMm,'x')+ruler(area.heightMm,'y')+'<div class="pdf-composition-canvas" data-pdf-composition-canvas role="group" aria-label="'+esc(tr('compositionCanvas'))+'" aria-describedby="'+help+'"><canvas hidden aria-hidden="true" data-pdf-composition-proof></canvas>';
   for(const item of items){
    if(!item.box)continue;
    const name=esc(label(item)),id=esc(item.key);
    html+='<div class="pdf-composition-box" data-pdf-composition-box="'+id+'"><button type="button" class="pdf-composition-handle" data-pdf-composition-handle="'+id+'" aria-label="'+esc(tr('compositionMove'))+' '+name+'" aria-describedby="'+help+'" aria-pressed="'+(item.key===selectedKey)+'" title="'+name+'"><span>'+name+'</span></button>';
    if(item.key===selectedKey)html+='<button type="button" class="pdf-composition-resize" data-pdf-composition-resize="'+id+'" aria-label="'+esc(tr('compositionResize'))+' '+name+'" aria-describedby="'+help+'">↘</button>';
    html+='</div>';
   }
   html+='</div></div>';
  }
  html+='<label class="field">'+esc(tr('compositionItem'))+'<select data-pdf-composition-select>'+items.map(item=>'<option value="'+esc(item.key)+'"'+(item.key===selectedKey?' selected':'')+'>'+esc(label(item))+'</option>').join('')+'</select></label>'+button('compositionEditObject','edit')+arrangeFields(items);
  const selected=items.find(item=>item.key===selectedKey);if(selected?.box)for(const name of fields)html+='<label class="field">'+esc(tr('composition'+name[0].toUpperCase()+name.slice(1)))+'<input type="number" min="'+(['widthMm','heightMm'].includes(name)?.001:0)+'" max="'+(name==='xMm'||name==='widthMm'?area?.widthMm??1000:area?.heightMm??1000)+'" step="any" data-pdf-composition-field="'+name+'" data-pdf-composition-key="'+esc(selectedKey)+'" value="'+selected.box[name]+'"></label>';
  return html+'<p data-pdf-selected-finding role="status"></p><p>'+esc(tr('compositionAuthority'))+'</p></details>';
 }
 function refresh(){
  if(gesture||!root)return;if(!getSection()?.composition){proof.clear();return;}const area=pdfCompositionArea(layout());if(!area)return;
  const canvas=root.querySelector('[data-pdf-composition-canvas]'),grid=getSection().composition.gridMm;if(!canvas)return;
  if(root.ownerDocument.hidden||canvas.closest('details:not([open])')){proof.clear();proof.bind(canvas);return;}
  canvas.dataset.pdfGridEnabled=String(grid>0);Object.assign(canvas.style,{aspectRatio:area.widthMm+'/'+area.heightMm,backgroundSize:grid>0?grid/area.widthMm*100+'% '+grid/area.heightMm*100+'%':'auto'});
  const state=current(),nodes=new Map([...canvas.querySelectorAll('[data-pdf-composition-box]')].map(node=>[node.dataset.pdfCompositionBox,node]));
  for(const item of state.items){
   const node=nodes.get(item.key);if(!node||!item.box)continue;locate(node,item.box,area);
   const handle=node.firstElementChild,text=label(item),span=handle.firstElementChild;if(span.textContent!==text)span.textContent=text;
   handle.setAttribute('aria-pressed',String(picked.has(item.key)));
   handle.setAttribute('aria-label',tr('compositionMove')+' '+text);handle.title=text;
  }
  const unavailable=!canPrint()||!state.ready||!!getSection().placementReview;
  const pin=!blocked&&!unavailable&&isSaved()?{id:getDocument().header.id,revision:getDocument().revision,sectionId:getSection().id}:null;
  proof.update(pin);proof.bind(canvas);const {phase,error}=proof.state();
  canvas.dataset.proof=phase;const proofStatus=root.querySelector('[data-pdf-proof-status]');
  proofStatus.textContent=tr(phase==='ready'?'compositionProofReady':unavailable||phase==='failed'?'compositionProofFailed':'compositionProofPending')+(error?' '+error:!canPrint()?' '+t('errors','PDF_DESKTOP'):'');
  root.querySelector('[data-pdf-proof-retry]').hidden=phase!=='failed';
  const status=root.querySelector('[data-pdf-composition-status]');if(status)status.textContent=issueText(state);
  const selected=state.items.find(item=>item.key===selectedKey),findings=[...proof.state().findings,...compositionDiagnostics(getPreflight()?.findings??[],getSection().id)],codes=new Set();
  for(const issue of state.issues)if([issue.target,issue.other].some(target=>target&&pdfCompositionKey(target)===selectedKey))codes.add(issue.code);
  for(const finding of findings)if(finding.code==='PDF_FONT_FAILED'||selected&&(
   finding.blockId==='composition-'+selected.key||selected.target.kind==='image'&&finding.blockId?.includes(selected.target.id)||selected.target.kind==='block'&&finding.blockIndex===selected.target.index))codes.add(finding.code);
  root.querySelector('[data-pdf-selected-finding]').textContent=[...codes].map(code=>t('errors',code)).join(' ');
  const multi=root.querySelector('[data-pdf-arrange-items]');for(const option of multi?.options??[])option.selected=picked.has(option.value);
  const apply=root.querySelector('[data-command="composition-arrange"]');if(apply)apply.disabled=!arranged();
 }
 function arranged(){
  const area=pdfCompositionArea(layout()),composition=getSection()?.composition;if(!area||!composition)return null;
  const [axis,placement]=arrangement.split('-');return arrangeComposition(composition.boxes,picked,area,{axis,placement,relative});
 }
 function input(el){
  if(context!==key())reset();const section=getSection();if(!section)return false;
  if(el.hasAttribute('data-pdf-composition-mode')){if(el.value==='page'&&!section.composition){oneColumn();section.composition=pdfCompositionDefaults(section,layout());}else if(el.value==='flow')delete section.composition;else return true;changed();draw();return true;}
  if(el.hasAttribute('data-pdf-composition-select')){selectItem(el.value);return true;}
  if(!section.composition)return false;
  if(el.hasAttribute('data-pdf-arrange-items')){
   picked.clear();for(const item of el.selectedOptions)picked.add(item.value);
   if(picked.size)selectItem(picked.has(selectedKey)?selectedKey:[...picked][0],{keep:true});else refresh();return true;
  }
  if(el.hasAttribute('data-pdf-arrange-relative')){relative=el.value;refresh();return true;}
  if(el.hasAttribute('data-pdf-arrange-position')){arrangement=el.value;refresh();return true;}
  if(el.hasAttribute('data-pdf-composition-grid')){const value=el.value===''?NaN:Number(el.value);if(!Number.isFinite(value)||value<0||value>50){el.setAttribute?.('aria-invalid','true');return true;}el.removeAttribute?.('aria-invalid');section.composition.gridMm=value;changed();refresh();return true;}
  if(el.hasAttribute('data-pdf-composition-snap')){section.composition.snap=el.checked;changed();return true;}
  const name=el.dataset.pdfCompositionField;if(!fields.includes(name))return false;const box=section.composition.boxes.find(value=>pdfCompositionKey(value.target)===el.dataset.pdfCompositionKey),area=pdfCompositionArea(layout());if(!box||!area)return true;const next={...box,[name]:el.value===''?NaN:Number(el.value)};
  if(!validPdfCompositionBox(next)||next.xMm+next.widthMm>area.widthMm+1e-7||next.yMm+next.heightMm>area.heightMm+1e-7){el.setAttribute?.('aria-invalid','true');return true;}el.removeAttribute?.('aria-invalid');Object.assign(box,next);changed();refresh();return true;
 }
 function action(command){
  if(command==='composition-edit'){if(!blocked)editObject?.(current().items.find(item=>item.key===selectedKey)?.target);return true;}
  if(command==='composition-arrange'){
   const boxes=arranged(),composition=getSection()?.composition;
   if(boxes&&boxes.some((box,i)=>fields.some(field=>box[field]!==composition.boxes[i][field]))){getSection().composition={...composition,boxes};changed();selectItem(selectedKey,{keep:true});}
   return true;
  }
  if(command==='composition-proof-retry'){proof.clear();refresh();return true;}
  if(command!=='composition-adjust')return false;if(context!==key())reset();const section=getSection();if(!section?.composition)return true;oneColumn();section.composition=pdfAdjustComposition(section,layout());changed();draw();return true;
 }
 function bind(host){
  controller?.abort();controller=new AbortController();root=host;gesture=null;if(!root||disposed)return;
  const options={signal:controller.signal},ownerKey=key();
  const same=()=>!disposed&&!blocked&&key()===ownerKey&&!!getSection()?.composition;
  function control(event){
   const node=event.target?.closest?.('[data-pdf-composition-handle],[data-pdf-composition-resize]');
   if(!node||!same()||node.closest('[inert]'))return null;
   const container=node.parentElement,id=container.dataset.pdfCompositionBox;
   const box=getSection().composition.boxes.find(item=>pdfCompositionKey(item.target)===id);
   if(!box)return null;
   return {node,container,id,box,resize:node.hasAttribute('data-pdf-composition-resize')};
  }
  function changeBox(item,next){
   if(!same())return;const section=getSection();
   selectedKey=item.id;
   const boxes=section.composition.boxes;
   if(next&&next.some((box,i)=>fields.some(field=>box[field]!==boxes[i][field]))){
    section.composition={...section.composition,boxes:next};
    changed();
   }
   selectItem(item.id,{keep:true});
   item.node.focus({preventScroll:true});
  }
  function movement(item,area){
   const b=item.box,composition=getSection().composition,grid=composition.snap?composition.gridMm:0;
   if(!item.resize)return compositionMovement(composition.boxes,picked.has(item.id)?picked:new Set([item.id]),b,area,grid);
   return (dx,dy)=>{
    const next=pdfCompositionGeometry(b,area,{widthMm:b.widthMm+dx,heightMm:b.heightMm+dy},grid);
    return next?new Map([[b,next]]):null;
   };
  }
  const applyEdits=(composition,edits)=>edits?composition.boxes.map(box=>edits.get(box)??box):null;
  function cancel(){if(!gesture)return;const saved=gesture;gesture=null;if(saved.node.hasPointerCapture?.(saved.pointerId))saved.node.releasePointerCapture(saved.pointerId);refresh();}
  root.addEventListener('focusin',event=>{
   const item=control(event);if(item&&!gesture&&item.id!==selectedKey)selectItem(item.id,{keep:true});
  },options);
  root.addEventListener('pointerdown',event=>{
   const item=control(event);if(!item||event.button!==0||gesture)return;
   if((event.shiftKey||event.ctrlKey||event.metaKey)&&!item.resize){
    event.preventDefault();
    if(picked.has(item.id)&&picked.size>1){
     picked.delete(item.id);const primary=[...picked][0];selectItem(primary,{keep:true});
     root.querySelector('[data-pdf-composition-handle="'+primary+'"]')?.focus({preventScroll:true});
    }else{picked.add(item.id);selectItem(item.id,{keep:true});item.node.focus({preventScroll:true});}
    return;
   }
   const area=pdfCompositionArea(layout()),rect=item.container.parentElement.getBoundingClientRect();if(!area||!rect.width||!rect.height)return;
   event.preventDefault();item.node.focus();item.node.setPointerCapture?.(event.pointerId);
   const nodes=new Map([[item.id,item.container]]);
   if(!item.resize&&picked.size>1&&picked.has(item.id)){
    for(const node of item.container.parentElement.children)if(picked.has(node.dataset.pdfCompositionBox))nodes.set(node.dataset.pdfCompositionBox,node);
   }
   gesture={...item,pointerId:event.pointerId,x:event.clientX,y:event.clientY,area,rect,composition:getSection().composition,move:movement(item,area),nodes,edits:null};
  },options);
  root.addEventListener('pointermove',event=>{
   const value=gesture;if(!value||value.pointerId!==event.pointerId||!same())return;
   if(getSection().composition!==value.composition){cancel();return;}
   const dx=(event.clientX-value.x)*value.area.widthMm/value.rect.width,dy=(event.clientY-value.y)*value.area.heightMm/value.rect.height;
   value.edits=value.move?.(dx,dy);
   if(value.edits){for(const box of value.edits.values()){const node=value.nodes.get(pdfCompositionKey(box.target));if(node)locate(node,box,value.area);}value.container.parentElement.dataset.proof='moving';
    root.querySelector('[data-pdf-proof-status]').textContent=tr('compositionProofPending');}
  },options);
  root.addEventListener('pointerup',event=>{
   const value=gesture;if(!value||value.pointerId!==event.pointerId)return;gesture=null;
   if(value.node.hasPointerCapture?.(event.pointerId))value.node.releasePointerCapture(event.pointerId);
   if(getSection()?.composition===value.composition)changeBox(value,applyEdits(value.composition,value.edits));
  },options);
  root.addEventListener('pointercancel',cancel,options);
  root.addEventListener('lostpointercapture',cancel,options);
  root.addEventListener('click',event=>{const item=control(event);if(!event.detail&&item)changeBox(item,null);},options);
  root.addEventListener('dblclick',event=>{const item=control(event);if(item&&!item.resize){event.preventDefault();editObject?.(item.box.target);}},options);
  root.addEventListener('keydown',event=>{
   const item=control(event);if(!item)return;
   if(event.key==='Escape'&&gesture){event.preventDefault();cancel();return;}
   if(event.key==='Enter'&&!item.resize&&!event.repeat){event.preventDefault();editObject?.(item.box.target);return;}
   const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},direction=directions[event.key];
   if(!direction||event.altKey||event.ctrlKey||event.metaKey)return;event.preventDefault();event.stopPropagation();
   const section=getSection(),step=(section.composition.snap&&section.composition.gridMm||1)*(event.shiftKey?10:1),area=pdfCompositionArea(layout());
   if(area)changeBox(item,applyEdits(section.composition,movement(item,area)?.(direction[0]*step,direction[1]*step)));
  },options);
  root.addEventListener('toggle',refresh,{...options,capture:true});root.ownerDocument.addEventListener('visibilitychange',refresh,options);
  refresh();
 }
 function suspend(value){
  if(blocked===value)return;blocked=value;proof.clear();gesture=null;if(value)closeObject?.();
  const panel=root?.querySelector('[data-pdf-composition-editor]');if(panel)panel.hidden=value;
  if(!value)refresh();
 }
 return {view,input,action,bind,refresh,suspend,release(){reset();},dispose(){disposed=true;reset();}};
}
