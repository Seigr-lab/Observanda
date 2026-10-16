import {t} from './i18n/index.js';
// Section structure is an explicit saved command. Text edits use the separate
// recoverable writing owner; omitted sections never enter either command.
export function recordSectionActions({state,api,esc,current,refresh,edit,render,report}){
 const text=(key,args)=>t('recordContent',key,args),pending=new Map();let saving=false,context=null;
 function checkContext(){const next=state.access?.locked?null:JSON.stringify([state.storage?.contextId,state.book?.id]);if(next!==context){pending.clear();context=next;}}
 const owner=reading=>JSON.stringify([state.storage?.contextId,reading.workspaceId,reading.recordId]);
 const waiting=()=>{checkContext();return current()&&pending.has(owner(current()));};
 const button=(label,action,sectionId='',disabled=false)=>'<button type="button" class="button" data-action="stored-section-'+action+'"'+(sectionId?' data-section="'+sectionId+'"':'')+(saving||disabled||action!=='retry'&&waiting()?' disabled':'')+'>'+esc(label)+'</button>';
 const add=()=>button(text('addSection'),'add')+(waiting()?'<span role="status">'+esc(text('sectionPending'))+'</span>'+button(text('retrySection'),'retry'):'');
 const controls=(section,position,total)=>'<div class="inline-actions">'+button(text('moveUp'),'up',section.id,position===0)+button(text('moveDown'),'down',section.id,position===total-1)+button(text('removeSection'),'remove',section.id)+'</div>';
 async function action(control){
  const action=control.dataset.action?.slice('stored-section-'.length);
  if(!control.dataset.action?.startsWith('stored-section-'))return false;
  checkContext();if(!['add','retry','up','down','remove'].includes(action))return true;
  if(saving)return true;const reading=current();if(!reading)return true;
  if(waiting()&&action!=='retry')return true;
  const id=control.dataset.section,section=reading.sections.values.find(value=>value.id===id),position=reading.sections.offset+reading.sections.values.findIndex(value=>value.id===id);
  if(!['add','retry'].includes(action)&&!section)return true;
  if(action==='remove'&&!confirm(text('confirmRemove',{title:section.title})))return true;
  const target={workspaceId:reading.workspaceId,recordId:reading.recordId,sectionId:action==='add'?crypto.randomUUID():id,expectedStructureRevision:reading.structureRevision};
  const ownerKey=owner(reading),command=action==='retry'?pending.get(ownerKey):action==='add'?{...target,action:'insert',beforeId:null,value:{title:text('newSection'),body:''}}:
   action==='remove'?{...target,action:'remove',expectedValueRevision:reading.writingRevisions[id]}:
   {...target,action:'move',position:position+(action==='up'?-1:1)};
  if(!command)return true;
  const storageContext=state.storage?.contextId;
  const owned=()=>state.storage?.contextId===storageContext&&state.book?.id===command.workspaceId&&state.selected===command.recordId&&!state.access?.locked;
  pending.set(ownerKey,command);
  saving=true;render();
  try{
   await api('/api/research/records/sections',command,{adopt:false});
   pending.delete(ownerKey);
   if(!owned())return true;
   state.recordSection=command.action==='remove'?null:command.sectionId;await refresh();
   if(command.action==='insert'&&owned())await edit({recordId:command.recordId,sectionId:command.sectionId});
  }catch(error){if(['INVALID','MISSING','RECORD_CHANGED','INTAKE_COMPLETION'].includes(error.code))pending.delete(ownerKey);report(error);}
  finally{saving=false;render();}
  return true;
 }
 return {add,controls,action,checkContext};
}
