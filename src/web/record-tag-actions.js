import {t} from './i18n/index.js';
import {validRecordTag} from './record-tags-model.js';
export function recordTagActions({state,api,esc,current,refresh,reveal,render,report}){
 const text=(key,args)=>t('recordValues',key,args),pending=new Map(),drafts=new Map();let saving=false,context=null;
 const owner=reading=>JSON.stringify([state.storage?.contextId,reading.workspaceId,reading.recordId]);
 function checkContext(){const next=state.access?.locked?null:JSON.stringify([state.storage?.contextId,state.book?.id]);if(next!==context){pending.clear();drafts.clear();context=next;}}
 const waiting=()=>{checkContext();return current()&&pending.has(owner(current()));};
 const button=(label,action,position='')=>'<button type="button" class="button" data-action="record-tag-'+action+'" data-position="'+position+'"'+(saving||waiting()&&action!=='retry'?' disabled':'')+'>'+esc(text(label))+'</button>';
 function view(){
  checkContext();const reading=current();if(!reading)return '';const draft=drafts.get(owner(reading))??{},editing=draft.editing,values=reading.header.tags,offset=reading.collections.tags.offset,disabled=saving||waiting()?' disabled':'';
  return '<div class="record-tags">'+(waiting()?'<p role="status">'+esc(text('tagPending'))+'</p>'+button('retryTag','retry'):'')+
   (editing&&editing.revision!==reading.collections.tags.revision?'<p role="status">'+esc(text('tagRenameChanged',{name:editing.value}))+'</p>'+button('cancelTag','cancel'):'')+
   '<ul>'+values.map((tag,i)=>{const position=offset+i,edit=editing?.position===position&&editing.revision===reading.collections.tags.revision;return '<li><span>'+esc(tag)+'</span><div class="inline-actions">'+(edit?'<label>'+esc(text('tagName'))+'<input data-tag-input="rename" maxlength="40" value="'+esc(editing.value)+'"'+disabled+'></label>'+button('saveTag','rename',position)+button('cancelTag','cancel'):button('renameTag','edit',position)+button('removeTag','remove',position))+'</div></li>';}).join('')+'</ul>'+
   '<div class="inline-actions"><label>'+esc(text('newTag'))+'<input data-tag-input="add" maxlength="40" value="'+esc(draft.add??'')+'"'+disabled+'></label>'+button('addTag','add')+'</div></div>';
 }
 function input(element){if(!element.hasAttribute('data-tag-input')||!current())return false;const key=owner(current()),draft=drafts.get(key)??{};if(element.dataset.tagInput==='add')draft.add=element.value;else if(draft.editing)draft.editing.value=element.value;drafts.set(key,draft);return true;}
 document.addEventListener('keydown',event=>{const input=event.target.closest('[data-tag-input]');if(event.key!=='Enter'||event.isComposing||!input)return;event.preventDefault();event.stopPropagation();input.closest('.record-tags').querySelector('[data-action="record-tag-'+input.dataset.tagInput+'"]').click();});
 async function execute(reading,command){
  const key=owner(reading),storageContext=state.storage?.contextId,owned=()=>state.page==='record-reader'&&state.storage?.contextId===storageContext&&state.book?.id===command.workspaceId&&state.selected===command.recordId&&!state.access?.locked;
  pending.set(key,command);saving=true;render();
  try{const result=await api('/api/research/records/tags',command,{adopt:false});pending.delete(key);const draft=drafts.get(key);if(draft){if(command.action==='add'&&draft.add?.trim()===command.tag)draft.add='';else if(command.action==='rename')delete draft.editing;}
   if(owned()){await refresh();if(owned())await reveal(result.position);}
  }catch(error){if(['INVALID','MISSING','FORMAT','WORKSPACE_CHANGED','RECORD_CHANGED','TAG_EXISTS','INTAKE_COMPLETION'].includes(error.code))pending.delete(key);if(error.code==='RECORD_CHANGED'&&owned())await refresh();throw error;}
  finally{saving=false;render();}
 }
 async function action(control){
  if(!control.dataset.action?.startsWith('record-tag-'))return false;checkContext();const reading=current();if(!reading||saving)return true;
  const action=control.dataset.action.slice('record-tag-'.length),key=owner(reading);if(waiting()&&action!=='retry')return true;
  try{
   if(action==='retry'){const command=pending.get(key);if(command)await execute(reading,command);return true;}
   const draft=drafts.get(key)??{},position=Number(control.dataset.position),page=reading.collections.tags,tag=reading.header.tags[position-page.offset];
   if(action==='edit'){if(tag===undefined)return true;draft.editing={position,revision:page.revision,value:draft.editing?.revision!==page.revision&&draft.editing?draft.editing.value:tag};drafts.set(key,draft);render();document.querySelector('[data-tag-input="rename"]')?.focus();return true;}
   if(action==='cancel'){delete draft.editing;drafts.set(key,draft);render();return true;}
   if(!['add','rename','remove'].includes(action))return true;
   if(action!=='add'&&tag===undefined)return true;
   const value=action==='remove'?null:(action==='add'?draft.add:draft.editing?.value)?.trim();if(action!=='remove'&&!validRecordTag(value))throw Error(text('tagInvalid'));
   if(action==='remove'&&!confirm(text('confirmRemoveTag',{tag})))return true;
   await execute(reading,{workspaceId:reading.workspaceId,recordId:reading.recordId,id:crypto.randomUUID(),action,position:action==='add'?null:position,tag:value,expectedRevision:action==='rename'?draft.editing.revision:page.revision});
  }catch(error){report(error);}return true;
 }
 return {view,input,action,checkContext};
}
