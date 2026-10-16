import {t} from './i18n/index.js';
import {RELATION_TYPES} from './record-model.js';
import {WORKFLOW_ROLES} from './record-workflow.js';
import {recordRevisionView} from './record-revision-view.js';
import {applyRichTextStyles} from './rich-text-stylesheet.js';
import {revisionText} from './revision-model.js';
const tr=(key,values)=>t('online',key,values);
const same=(a,b)=>revisionText(a)===revisionText(b);

// One bounded picker and one link draft stay in the shared record view. The
// text editor and detail form keep their selections and unfinished changes.
export function onlineRelationships({remote,esc,notify,mediaUrl}){
 let host,record,relations=[],readOnly=false,busy=false,disposed=false,draft=null,request=null,choices=new Map(),after=null,viewGeneration=0,generation=0;
 const button=(key,action,id='')=>'<button type="button" class="button" data-link-action="'+action+'" data-link-id="'+esc(id)+'">'+esc(tr(key))+'</button>';
 const typeName=type=>tr('linkType'+RELATION_TYPES.indexOf(type));
 const current=()=>relations.find(r=>r.id===draft?.id)??null;
 const conflicted=()=>!request&&draft&&draft.before!==null&&!same(current(),draft.before);
 function controls(){
  if(!host)return;
  for(const b of host.querySelectorAll('[data-link-action]'))b.disabled=busy||!!request||(['add','edit','remove','search','more','inspect','latest'].includes(b.dataset.linkAction)&&readOnly);
  const form=host.querySelector('form');for(const el of form.elements)el.disabled=busy||!!request||readOnly||!!draft?.remove;
  form.elements.pin.disabled||=!!form.elements.role.value;
  const submit=form.querySelector('[type="submit"]');submit.disabled=busy||readOnly||!!conflicted();submit.textContent=tr(request?'retrySend':draft?.remove?'linkRemove':'linkSave');
  form.querySelector('[data-link-action="cancel"]').disabled=busy||!!request;
  form.querySelector('[data-link-conflict]').hidden=!conflicted();
  form.querySelector('[data-link-action="latest"]').disabled=busy||!!request||readOnly;
  host.setAttribute('aria-busy',String(busy));
 }
 function draw(){
  const list=host.querySelector('[data-link-list]'),html=relations.length?'<ul>'+relations.map(link=>'<li><strong>'+esc(link.label||tr('linkUnnamed'))+'</strong><p>'+esc(link.role?tr('linkRole_'+link.role):RELATION_TYPES.includes(link.type)?typeName(link.type):link.type)+' · '+esc(tr(link.target.revision?'linkPinned':'linkCurrent'))+'</p>'+(link.target.revision?'<code>'+esc(link.target.revision)+'</code>':'')+'<div class="module-actions">'+(link.target.kind==='record'?button('linkRead','read',link.id):'')+(!readOnly?button('linkEdit','edit',link.id)+button('linkRemove','remove',link.id):'')+'</div></li>').join('')+'</ul>':'<p>'+esc(tr('linksEmpty'))+'</p>';if(list.innerHTML!==html)list.innerHTML=html;controls();
 }
 function update(next,version=generation){if(disposed||version!==generation)return;relations=structuredClone(next);draw();}
 function setChoices(){
  const select=host.querySelector('[name="target"]'),selected=draft?.target;
  const items=[...choices.values()];if(selected&&!items.some(r=>r.id===selected.id))items.unshift(selected);
  select.innerHTML='<option value="">'+esc(tr('linkChoose'))+'</option>'+items.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.title)+'</option>').join('');select.value=selected?.id??'';
  host.querySelector('[data-link-action="more"]').hidden=!after;
 }
 async function search(more=false){
  if(busy||request||readOnly||!draft)return;busy=true;controls();
  try{
   const result=await remote('link-targets',{recordId:record.id,query:host.querySelector('[name="query"]').value,notebookId:host.querySelector('[name="notebook"]').value||null,after:more?after:null});if(disposed)return;
   if(!more)choices.clear();for(const item of result.records)choices.set(item.id,item);after=result.next;
   const notebooks=host.querySelector('[name="notebook"]'),selected=notebooks.value;notebooks.innerHTML='<option value="">'+esc(tr('linkAllBooks'))+'</option>'+result.notebooks.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.title)+'</option>').join('');notebooks.value=selected;setChoices();
   host.querySelector('[data-link-search-status]').textContent=tr('linkChoices',{count:choices.size});
  }finally{busy=false;controls();}
 }
 function begin(link=null){
  if(busy||request||draft||readOnly)throw Error(tr('linksFinish'));
  draft={id:link?.id??crypto.randomUUID(),before:link?structuredClone(link):null,target:link?.target.kind==='record'?{id:link.target.id,title:link.label,revision:link.target.revision??null}:null,remove:false};
  const form=host.querySelector('form');form.hidden=false;form.reset();form.elements.type.value=link&&RELATION_TYPES.includes(link.type)?link.type:'Related to';form.elements.role.value=link?.role??'';form.elements.pin.checked=!!link?.target.revision;choices.clear();after=null;setChoices();controls();
  host.querySelector('[data-link-status]').textContent='';form.elements.role.focus();
 }
 function cancel(){draft=null;request=null;host.querySelector('form').hidden=true;controls();}
 async function read(linkId=null){
  if(busy||request)return;const selected=draft?.target;if(!linkId&&!selected)return;
  const generation=++viewGeneration;busy=true;controls();const view=host.querySelector('[data-link-view]');view.textContent=tr('busy');
  try{
   const result=await remote(linkId?'link-read':'read',linkId?{recordId:record.id,linkId}:{recordId:selected.id});if(disposed||generation!==viewGeneration)return;
   // Inspecting the selected current record explicitly adopts its displayed
   // revision. Saving still checks it did not change after this inspection.
   if(!linkId&&draft){draft.target={id:result.record.id,title:result.record.title,revision:result.revision};setChoices();}
   view.innerHTML='<h4>'+esc(result.record.title)+'</h4><p>'+esc(tr(linkId?'linkReadingSaved':'linkReadingCurrent'))+'</p><code>'+esc(result.revision)+'</code>'+recordRevisionView(result.record,esc,{figureSources:false,assetUrl:id=>mediaUrl(linkId?record.id:result.record.id,id,linkId?{linkId,revision:result.revision}:null)});applyRichTextStyles(document,result.record);
  }catch(error){view.textContent=error.message;throw error;}finally{busy=false;controls();}
 }
 async function save(){
  if(!draft||disposed)return;if(busy||readOnly)throw Error(tr('linksFinish'));if(conflicted())throw Error(tr('linkConflict'));
  const form=host.querySelector('form');if(!request&&!draft.remove){
   if(!form.reportValidity()||!draft.target)throw Error(tr('linkChoose'));
   const role=form.elements.role.value||null,pin=role?WORKFLOW_ROLES.find(r=>r.id===role).exact:form.elements.pin.checked;
   if(pin&&!draft.target.revision)throw Error(tr('linkInspectFirst'));
   request={recordId:record.id,id:crypto.randomUUID(),linkId:draft.id,before:draft.before,value:{type:form.elements.type.value,role,target:{id:draft.target.id,revision:pin?draft.target.revision:null}}};
  }
  request??={recordId:record.id,id:crypto.randomUUID(),linkId:draft.id,before:draft.before,value:null};busy=true;generation++;controls();
  try{
   await remote('link-write',request);request=null;cancel();host.querySelector('[data-link-status]').textContent=tr('linkSaved');notify(tr('linkSaved'));
   const result=await remote('links',{recordId:record.id});if(!disposed)update(result.relations);
  }catch(error){
   if(['RECORD_CHANGED','INVALID','COLLABORATION_INVALID','COLLABORATION_DENIED','CONFLICT','LIMIT','MATERIAL_MISSING','MATERIAL_INVALID'].includes(error.code))request=null;
   if(error.code==='RECORD_CHANGED'){const result=await remote('links',{recordId:record.id});if(!disposed)update(result.relations);throw Error(tr('linkStale'));}throw error;
  }finally{busy=false;generation++;controls();}
 }
 function mount(node,value,role){
  host=node;record=value;relations=structuredClone(value.relations);readOnly=role!=='editor';
  host.innerHTML='<details data-live-links><summary>'+esc(tr('linksTitle'))+'</summary><p>'+esc(tr('linksHelp'))+'</p><div data-link-list></div>'+(!readOnly?button('linkAdd','add'):'')+'<form data-link-form hidden><div class="online-details-grid"><label>'+esc(tr('linkPurpose'))+'<select name="role"><option value="">'+esc(tr('linkOrdinary'))+'</option>'+WORKFLOW_ROLES.filter(r=>value.type==='run'||!['run-of','follows-run'].includes(r.id)).map(r=>'<option value="'+r.id+'">'+esc(tr('linkRole_'+r.id))+'</option>').join('')+'</select></label><label>'+esc(tr('linkType'))+'<select name="type">'+RELATION_TYPES.map(type=>'<option value="'+esc(type)+'">'+esc(typeName(type))+'</option>').join('')+'</select></label><label>'+esc(tr('linkSearch'))+'<input name="query" maxlength="180"></label><label>'+esc(tr('linkBook'))+'<select name="notebook"><option value="">'+esc(tr('linkAllBooks'))+'</option></select></label></div><div class="module-actions">'+button('linkSearchButton','search')+button('linkMore','more')+'</div><p role="status" data-link-search-status></p><label>'+esc(tr('linkTarget'))+'<select name="target" required></select></label><label class="online-link-pin"><input type="checkbox" name="pin">'+esc(tr('linkPin'))+'</label>'+button('linkInspect','inspect')+'<div data-link-conflict role="status" hidden><p>'+esc(tr('linkConflict'))+'</p>'+button('linkUseLatest','latest')+'</div><div class="module-actions"><button type="submit" class="button">'+esc(tr('linkSave'))+'</button>'+button('linkCancel','cancel')+'</div></form><p role="status" data-link-status></p><div data-link-view></div></details>';
  for(const [name,key] of Object.entries({role:'linkPurpose',type:'linkType',query:'linkSearch',notebook:'linkBook',target:'linkTarget'})){const input=host.querySelector('[name="'+name+'"]');input.setAttribute('aria-label',tr(key));input.closest('label').classList.add('field');}
  draw();
  host.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();void save().catch(e=>notify(e.message,true));});
  host.addEventListener('change',event=>{
   if(event.target.name==='target'&&draft){draft.target=choices.get(event.target.value)??(draft.target?.id===event.target.value?draft.target:null);}
   if(event.target.name==='role'){const form=host.querySelector('form'),role=WORKFLOW_ROLES.find(r=>r.id===form.elements.role.value);if(role)form.elements.pin.checked=role.exact;if(role?.id==='uses-method')form.elements.type.value='Uses';controls();}
  });
  host.addEventListener('click',event=>{const control=event.target.closest('[data-link-action]');if(!control)return;
   void (async()=>{const action=control.dataset.linkAction,link=relations.find(r=>r.id===control.dataset.linkId);
    if(action==='add'){begin();await search();}
    if(action==='edit'){begin(link);await search();}
    if(action==='remove'){begin(link);draft.remove=true;await save();}
    if(action==='cancel')cancel();
    if(action==='search'||action==='more')await search(action==='more');
    if(action==='read')await read(control.dataset.linkId);
    if(action==='inspect')await read();
    if(action==='latest'){const latest=current();cancel();begin(latest);await search();}
   })().catch(e=>notify(e.message,true));
  });
 }
 return {mount,update,save,revision:()=>generation,isDirty:()=>!!draft||busy||!!request,isBusy:()=>busy,setReadOnly(){readOnly=true;controls();},dispose(){disposed=true;viewGeneration++;generation++;}};
}
