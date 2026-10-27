import '../i18n/catalogues/moduleReferences.js';
import {researchTargetPicker} from '../research-target-picker.js';
import {researchId} from '../research-reference.js';
import {t} from '../i18n/index.js';
const tr=(key,values)=>t('moduleReferences',key,values);

// The editor owns its draft. This owner discovers research through summary
// pages and labels only the links displayed in the current module view.
export function moduleReferencesUI(services,{moduleId,current,changed,draw}){
 const {state,api,esc,field,showDialog}=services;
 const active=()=>state.page==='module'&&state.moduleId===moduleId&&!state.access?.locked&&!state.storageUnavailable;
 const picker=researchTargetPicker({state,api,esc,field,showDialog,active,excludeId:()=>null});
 let controller=null,root=null,stamp=null,selectionStamp=null;
 const selectedLabels=new Map();
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.etag,state.modulePath]);
 function stop(){controller?.abort();controller=null;root=null;stamp=null;selectionStamp=null;selectedLabels.clear();picker.stop();}
 function label(id){return `<span data-module-record-label="${esc(id)}">${esc(tr('loading'))}</span>`;}
 function recordLink(id){return `<button type="button" class="text-button" data-action="edit-entry" data-reading="true" data-id="${esc(id)}">${label(id)}</button>`;}
 function recordField(key,title){
  const id=current().data[key];
  return field(esc(title),`<button type="button" class="button" aria-label="${esc(title)}" data-action="module-reference-record" data-module-record-field="${esc(key)}">${id?label(id):esc(tr('chooseRecord'))}</button>`);
 }
 function researchButton(){return `<button type="button" class="button" data-action="module-reference-add">${esc(tr('chooseResearch'))}</button>`;}
 async function loadLabels(node,key){
  const request=controller=new AbortController(),workspaceId=state.book.id,etag=state.etag;
  const valid=()=>!request.signal.aborted&&active()&&node.isConnected&&key===identity()&&root===node;
  const nodes=[...node.querySelectorAll('[data-module-record-label]')],visible=new Set(nodes.map(n=>n.dataset.moduleRecordLabel));
  // A chosen summary can be newer than the shell's pinned outline. Keep its
  // title while this view is open, bounded to references currently displayed.
  if(selectionStamp!==key)selectedLabels.clear();
  for(const id of selectedLabels.keys())if(!visible.has(id))selectedLabels.delete(id);
  for(const target of nodes)if(selectedLabels.has(target.dataset.moduleRecordLabel))target.textContent=selectedLabels.get(target.dataset.moduleRecordLabel);
  const ids=[...visible].filter(id=>!selectedLabels.has(id));
  try{
   for(let offset=0;offset<ids.length;offset+=25){
    const selected=ids.slice(offset,offset+25);
    let records,missing;
    if(state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21){
     const result=await api('/api/workspace/read/labels',{workspaceId,etag,ids:selected},{adopt:false,signal:request.signal});
     records=result.records;missing=result.missing;
     if(result?.workspaceId!==workspaceId||result.etag!==etag||!Array.isArray(records)||!Array.isArray(missing)||records.length+missing.length!==selected.length||new Set([...records.map(r=>r?.id),...missing]).size!==selected.length||records.some(r=>!r||!selected.includes(r.id)||!researchId(r.notebookId)||typeof r.title!=='string')||missing.some(id=>!selected.includes(id)))throw Error(tr('invalid'));
    }else{records=state.book.entries.filter(r=>selected.includes(r.id));missing=selected.filter(id=>!records.some(r=>r.id===id));}
    if(!valid())return;
    for(const target of nodes.filter(n=>selected.includes(n.dataset.moduleRecordLabel))){
     const record=records.find(r=>r.id===target.dataset.moduleRecordLabel);target.textContent=record?.title??tr('unavailable');
     const link=target.closest('[data-action="edit-entry"]');if(link)link.disabled=!record;
    }
   }
  }catch(error){
   if(!valid())return;
   for(const target of nodes)if(target.textContent===tr('loading'))target.textContent=tr('unavailableLabel');
   const notice=document.createElement('div');notice.dataset.moduleReferenceError='';notice.setAttribute('role','alert');
   notice.innerHTML=`<p>${esc(error.message??tr('loadFailed'))}</p><button type="button" class="button" data-action="module-reference-retry">${esc(tr('retry'))}</button>`;node.prepend(notice);
  }finally{if(controller===request)controller=null;}
 }
 function bind(){
  picker.sync();if(!active()){stop();return;}
  const node=document.querySelector('.module-workbench'),key=identity();if(!node||root===node&&stamp===key)return;
  controller?.abort();root=node;stamp=key;void loadLabels(node,key);
 }
 async function action(button){
  if(await picker.action(button))return true;
  if(!button.dataset.action?.startsWith('module-reference-'))return false;
  if(button.dataset.action==='module-reference-retry'){root?.querySelector('[data-module-reference-error]')?.remove();root=null;bind();return true;}
  const draft=current();if(!draft)return true;
  const key=button.dataset.moduleRecordField,recordsOnly=button.dataset.action==='module-reference-record';
  picker.open({title:tr(recordsOnly?'chooseRecord':'chooseResearch'),recordsOnly,kinds:['record','notebook','project'],onChoose:async(item,{stillCurrent})=>{
   if(!stillCurrent()||current()!==draft)return;
   if(recordsOnly)draft.data[key]=item.id;
   else{
    const reference={workspaceId:item.workspaceId,type:item.kind,id:item.id};
    if(!draft.data.links.some(r=>r.workspaceId===reference.workspaceId&&r.type===reference.type&&r.id===reference.id))draft.data.links.push(reference);
   }
   if(item.kind==='record'){const key=identity();if(selectionStamp!==key)selectedLabels.clear();selectionStamp=key;selectedLabels.set(item.id,item.title);}
   document.querySelector('#dialog').close();picker.stop();changed();draw();
   document.querySelector(recordsOnly?'[data-module-record-field="'+key+'"]':'[data-action="module-reference-add"]')?.focus();
  }});
  return true;
 }
 return {recordLink,recordField,researchButton,bind,stop,action,input:picker.input};
}
