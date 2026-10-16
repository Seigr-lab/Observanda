import {configurationOf} from '../notebook-schema.js';
import {locationName} from '../workspace-structure.js';

import {sectionDetails,sectionInput,sectionAction} from './section-editor.js';

// A configuration draft is committed only through an explicit save.
export async function recordTypeSettings(services,profile){
 const {state,api,esc,field,option,draw,changed}=services,workspaceId=state.book.id;
 let snapshot,entity,base,draft,pending=null,request=null,error=null,disposed=false,selectedId=null,showRemoved=false;
 const copy=v=>structuredClone(v),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const labs=()=>snapshot.book.notebooks.filter(n=>configurationOf(n).profiles.some(p=>p.id===profile.id&&p.enabled)).map(n=>({...n,data:configurationOf(n)}));
 const isDirty=()=>!!pending||!!entity&&!equal(base,draft);
 const scoped=()=>(draft?.sections??[]).filter(s=>s.profileId===profile.id);
 const chosen=()=>scoped().find(s=>s.id===selectedId);
 function selectAvailable(){if(!chosen())selectedId=scoped().find(s=>s.enabled)?.id??scoped()[0]?.id??null;}
 function adopt(id){
  entity=labs().find(e=>e.id===id)??labs()[0];
  if(entity){entity=copy(entity);draft=copy(entity.data);}
  else draft=null;
  base=copy(draft);error=null;request=null;selectAvailable();
 }
 async function activate(){if(isDirty())return;const latest=await api('/api/notebook',undefined,{metadataOnly:true,adopt:false});if(isDirty()||disposed)return;snapshot=latest;adopt(entity?.id);}
 snapshot=await api('/api/notebook',undefined,{metadataOnly:true,adopt:false});adopt();
 const button=(label,command,attrs='',style='')=>`<button type="button" class="button ${style}" data-action="module-settings-command" data-command="${command}" ${attrs}>${esc(label)}</button>`;
 const context={field,option,esc,button,get current(){return {data:draft};}};
 const sectionChanged=s=>!equal(s,base.sections.find(b=>b.id===s.id));
 function validation(){
  for(const s of draft.sections){
   if(!s.label.trim())return {id:s.id,message:'Enter a name for each record type.'};
   for(const f of s.fields){
    if(!f.label.trim())return {id:s.id,message:'Enter a label for each field.'};
    if(f.type==='select'&&!f.choices.length)return {id:s.id,message:'Add at least one choice to '+f.label+'.'};
    if(new Set(f.choices).size!==f.choices.length)return {id:s.id,message:'Use distinct choices for '+f.label+'.'};
   }
  }
  return null;
 }
 function message(){return error?.message??(pending?'Saving changes…':isDirty()?'Unsaved changes':'No unsaved changes');}
 function status(){
  const node=document.querySelector('[data-type-status="'+profile.id+'"]');
  if(node){node.textContent=message();node.classList.toggle('desk-error',Boolean(error));}
  for(const command of ['save','cancel']){const control=document.querySelector('[data-type-controls="'+profile.id+'"] [data-command="'+command+'"]');if(control)control.disabled=!!pending||!isDirty();}
  for(const s of scoped()){
   const item=document.querySelector('[data-type-choice="'+s.id+'"]');
   if(item){item.querySelector('[data-type-title]').textContent=s.label||'Unnamed type';item.querySelector('[data-type-modified]').hidden=!sectionChanged(s);}
  }
  changed?.();
 }
 async function save(){
  if(pending){await pending;return;}
  if(!entity||equal(base,draft))return;
  const invalid=validation();if(invalid){selectedId=invalid.id;showRemoved=!chosen()?.enabled;error=new Error(invalid.message);draw();status();throw error;}
  if(state.book?.id!==workspaceId)throw new Error('Reopen this workspace before saving its record types.');
  const captured=copy(draft),notebook=snapshot.book.notebooks.find(n=>n.id===entity.id),payload={kind:'notebook',value:{...notebook,configuration:captured}};
  const signature=JSON.stringify(payload);if(request?.signature!==signature)request={signature,commandId:crypto.randomUUID()};
  error=null;
  pending=(async()=>{
   try{
    const result=await api('/api/workspace/structure',{etag:snapshot.etag,change:payload});
    state.book=result.book;state.etag=result.etag;
    snapshot=result;entity=copy(labs().find(e=>e.id===entity.id));base=copy(entity.data);
    if(equal(draft,captured))draft=copy(base);request=null;
   }catch(e){error=e;throw e;}
   finally{pending=null;if(!disposed){draw();status();}}
  })();
  draw();status();await pending;
 }
 function view(){
  if(!entity)return '<div class="lab-type-settings"><p>No lab book uses these tools yet. Choose them in a lab book\'s settings, then configure its record types here.</p></div>';
  selectAvailable();
  const types=scoped(),removed=types.filter(s=>!s.enabled),s=chosen(),index=draft.sections.indexOf(s);
  const active=types.filter(s=>s.enabled),position=active.indexOf(s);
  const choice=item=>`<button type="button" class="lab-type-choice" data-action="module-settings-command" data-command="select-type" data-id="${item.id}" data-type-choice="${item.id}" aria-current="${item.id===selectedId?'true':'false'}"><span data-type-title>${esc(item.label||'Unnamed type')}</span><small>${item.fields.length} ${item.fields.length===1?'field':'fields'}</small><span class="lab-type-modified" data-type-modified ${sectionChanged(item)?'':'hidden'}>Edited</span></button>`;
  return `<div class="lab-type-settings">
   <header><div><h3>Record types</h3><p>${esc(entity.title)} · ${esc(state.book.title)}</p></div><p class="lab-type-hint">Edit your types and fields, then save or cancel.</p></header>
   <fieldset class="lab-type-draft" ${pending?'disabled':''}>
    ${labs().length>1?field('Lab book',`<select data-type-lab>${labs().map(l=>option(l.id,locationName(snapshot.book,l.projectId)+' / '+l.title,entity.id)).join('')}</select>`):''}
    <div class="lab-type-layout"><aside class="lab-type-catalogue" aria-label="Record types">
     <div class="lab-type-list-heading"><strong>Types (${active.length})</strong>${button('Add record type','section-add','','subtle')}</div>
     <div class="lab-type-list">${active.map(choice).join('')||'<p>No active types.</p>'}</div>
     ${removed.length?`<details class="lab-removed-types" data-removed-types ${showRemoved?'open':''}><summary>Removed types (${removed.length})</summary>${removed.map(choice).join('')}</details>`:''}
    </aside><section class="lab-type-detail" aria-label="Selected record type">
     ${s?`<div class="lab-type-detail-heading"><strong>${s.enabled?'Type details':'Removed type'}</strong><div>
      ${s.enabled?button('Move up','section-move',`data-index="${index}" data-direction="-1" ${position<=0?'disabled':''}`,'subtle')+button('Move down','section-move',`data-index="${index}" data-direction="1" ${position===active.length-1?'disabled':''}`,'subtle')+button('Remove type','section-remove',`data-index="${index}"`,'subtle'):button('Restore type','section-restore',`data-index="${index}"`)}
     </div></div>${!s.enabled?'<p class="lab-type-hint">Removed types are unavailable for new records. Existing records are kept.</p>':''}${sectionDetails(s,index,context)}`:'<p>Add a record type to define its name and fields.</p>'}
    </section></div>
   </fieldset>
   <footer data-type-controls="${profile.id}"><span role="status" data-type-status="${profile.id}" class="${error?'desk-error':''}">${esc(message())}</span><div>${button('Cancel','cancel',pending||!isDirty()?'disabled':'')}${button('Save changes','save',pending||!isDirty()?'disabled':'','primary')}</div></footer>
   </div>`;
 }
 function bind(root){const details=root.querySelector('[data-removed-types]');if(details)details.ontoggle=()=>{showRemoved=details.open;};}
 function input(el){
  if(pending)return true;
  if(el.hasAttribute('data-type-lab')){
   if(isDirty()){el.value=entity.id;error=new Error('Save or cancel changes before choosing another lab.');status();}
   else {adopt(el.value);draw();}
   return true;
  }
  if(!sectionInput(el,draft))return false;
  error=null;status();
  if(['type','numericRepresentation'].includes(el.dataset.labFieldProp)){
   const index=el.dataset.labField;draw();
   document.querySelector('[data-module-settings-slot] [data-lab-field="'+index+'"][data-lab-field-prop="'+el.dataset.labFieldProp+'"]')?.focus({preventScroll:true});
  }
  return true;
 }
 async function discard(){
  if(pending)await pending;
  draft=copy(base);error=null;request=null;selectAvailable();
  if(!disposed){draw();status();}
 }
 async function action(name,node){
  if(pending)return;
  if(name==='save'){try{await save();}catch{}return;}
  if(name==='cancel'){await discard();return;}
  if(name==='select-type'){selectedId=node.dataset.id;draw();return;}
  const result=sectionAction(draft,name,node.dataset,profile.id);if(!result)return;
  if(result.added)selectedId=result.added;
  if(name==='section-remove')showRemoved=true;
  error=null;draw();status();
  if(result.added){const input=document.querySelector('[data-module-settings-slot] [data-lab-section-prop="label"]');input?.focus({preventScroll:true});input?.select();}
 }
 return {view,bind,input,action,activate,isDirty,save,discard,dispose(){disposed=true;}};
}
