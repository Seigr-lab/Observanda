import {t} from './i18n/index.js';

export function recordMediaActions({state,api,esc,current,refresh,reveal,render,report}){
 const text=(key,args)=>t('recordContent',key,args),pending=new Map();let saving=false,context=null;
 const owner=reading=>JSON.stringify([state.storage?.contextId,reading.workspaceId,reading.recordId]);
 function checkContext(){const next=state.access?.locked?null:JSON.stringify([state.storage?.contextId,state.book?.id]);if(next!==context){pending.clear();context=next;}}
 const waiting=()=>{checkContext();return current()&&pending.has(owner(current()));};
 const button=(label,action,id='',disabled=false)=>'<button type="button" class="button" data-action="stored-media-'+action+'" data-media="'+esc(id)+'"'+(saving||disabled?' disabled':'')+'>'+esc(label)+'</button>';
 const controls=item=>button(text('removeMedia'),'remove',item.id,waiting());
 const add=()=>'<div class="record-media-intake"><div class="field"><label for="record-media-upload">'+esc(text('addMedia'))+'</label><input id="record-media-upload" type="file" data-upload="record-attachment" accept="image/*,audio/*,video/*,.svg"'+(saving||waiting()?' disabled':'')+'></div><p class="muted">'+esc(text('addMediaHelp'))+'</p>'+(waiting()?'<p role="status">'+esc(text('mediaPending'))+'</p>'+button(text('retryMedia'),'retry'):'')+'</div>';
 async function execute(reading,command){
  const key=owner(reading),storageContext=state.storage?.contextId;
  const owned=()=>state.page==='record-reader'&&state.storage?.contextId===storageContext&&state.book?.id===command.workspaceId&&state.selected===command.recordId&&!state.access?.locked;
  pending.set(key,command);saving=true;render();
  try{
   const result=await api('/api/research/records/media',command,{adopt:false});pending.delete(key);
   if(owned()){await refresh();if(owned()&&command.action==='attach')await reveal(result.position);}
   return result;
  }catch(error){if(['INVALID','MISSING','FORMAT','WORKSPACE_CHANGED','RECORD_CHANGED','INTAKE_COMPLETION','MEDIA_IN_USE','MEDIA_INVALID'].includes(error.code))pending.delete(key);throw error;}
  finally{saving=false;render();}
 }
 async function attach(intent,asset){
  checkContext();const reading=current();
  if(!reading||state.page!==intent.page||state.selected!==intent.recordId||reading.workspaceId!==intent.workspaceId)throw Error(text('mediaDestinationChanged'));
  if(saving||waiting())throw Error(text('mediaPending'));
  return execute(reading,{workspaceId:reading.workspaceId,recordId:reading.recordId,action:'attach',mediaId:asset.id});
 }
 async function action(control){
  if(!control.dataset.action?.startsWith('stored-media-'))return false;
  checkContext();const reading=current();if(!reading||saving)return true;
  const action=control.dataset.action.slice('stored-media-'.length),key=owner(reading);
  if(waiting()&&action!=='retry')return true;
  try{
   if(action==='retry'){const command=pending.get(key);if(command)await execute(reading,command);}
   else if(action==='remove'){
    const id=control.dataset.media,item=reading.header.attachments.find(item=>item.id===id);if(!item)return true;
    // Read the selected value before asking for removal. Its own revision guards
    // concurrent caption/share changes without conflicting with unrelated edits.
    saving=true;render();let base;
    try{base=await api('/api/research/records/values/read',{workspaceId:reading.workspaceId,recordId:reading.recordId,field:'media:'+id},{adopt:false});}
    finally{saving=false;render();}
    if(current()!==reading)return true;
    if(confirm(text('confirmRemoveMedia',{label:base.value.value.caption||text('unnamedMedia')})))await execute(reading,{workspaceId:reading.workspaceId,recordId:reading.recordId,action:'remove',mediaId:id,expectedRevision:base.revision});
   }
  }catch(error){report(error);}
  return true;
 }
 return {add,controls,attach,action,checkContext};
}
