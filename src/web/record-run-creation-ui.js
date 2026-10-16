import {t} from './i18n/index.js';
const text=(key,args)=>t('recordWorkflow',key,args);
export function recordRunCreationUI({state,api,esc,notify,onCreated}){
 const dialog=document.createElement('dialog');dialog.className='record-writing';dialog.setAttribute('aria-labelledby','run-creation-title');document.body.append(dialog);let session=null;
 const context=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.selected,state.access?.locked]);
 const active=s=>session===s&&s.context===context()&&dialog.open;
 const key=s=>'observanda-run-intent:'+s.workspaceId+':'+s.sourceId;
 const remember=s=>{try{sessionStorage.setItem(key(s),s.id);}catch{}};
 const forget=s=>{try{sessionStorage.removeItem(key(s));}catch{}};
 const button=(label,action,disabled=false)=>'<button type="button" class="button" data-run-create="'+action+'"'+(disabled?' disabled':'')+'>'+esc(text(label))+'</button>';
 function paint(){const s=session;if(!s)return;dialog.innerHTML='<h2 id="run-creation-title">'+esc(text(s.repeating?'repeatTitle':'add'))+'</h2>'+(s.source?'<p>'+esc(s.source)+'</p>':'')+'<label>'+esc(text('creationName'))+'<input data-run-title required maxlength="180" value="'+esc(s.title??'')+'"'+(s.busy||s.pending?' disabled':'')+'></label><p>'+esc(text('creationHelp'))+'</p><details><summary>'+esc(text('creationInheritance'))+'</summary><p>'+esc(text('creationInheritanceHelp'))+'</p></details><p role="status">'+esc(s.busy?text('creationWorking'):'')+'</p><p role="alert">'+esc(s.error??'')+'</p><div class="dialog-actions">'+button('creationCancel','close',s.busy)+button(s.pending?'creationRetry':'creationSave','create',s.busy||!s.revision)+(s.stale?button('creationRefresh','refresh',s.busy):'')+'</div>';}
 function close(){const s=session;if(!s||s.busy)return;if(!s.pending)forget(s);session=null;dialog.close();dialog.innerHTML='';}
 async function created(s,result){if(!active(s))return;session=null;dialog.close();dialog.innerHTML='';try{await onCreated(result);forget(s);}catch(error){notify(error.message,true);}}
 async function load(s){s.busy=true;s.error='';paint();try{const result=await api('/api/research/records/runs/prepare',{workspaceId:s.workspaceId,sourceId:s.sourceId,id:s.id},{adopt:false});if(!active(s))return;if(result.saved){await created(s,result.saved);return;}s.revision=result.revision;s.source=result.title;s.repeating=result.repeating;s.title??=text(result.repeating?'repeatName':'newTitle',{title:result.title.slice(0,145)});s.stale=false;}catch(error){if(active(s))s.error=error.message;}finally{if(active(s)){s.busy=false;paint();}}}
 async function open(sourceId){
  if(session)return;if(state.dirty){notify(text('saveFirst'),true);return;}
  const s={workspaceId:state.book.id,sourceId,id:crypto.randomUUID(),context:context(),busy:true};try{const id=sessionStorage.getItem(key(s));if(/^[a-f0-9-]{36}$/.test(id??''))s.id=id;}catch{}
  session=s;paint();dialog.showModal();await load(s);
 }
 dialog.addEventListener('input',event=>{if(event.target.matches('[data-run-title]')&&session&&!session.busy&&!session.pending)session.title=event.target.value;});
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('click',async event=>{
  const s=session,action=event.target.closest('[data-run-create]')?.dataset.runCreate;if(!s||!action||s.busy||!active(s))return;
  if(action==='close'){close();return;}if(action==='refresh'){await load(s);return;}
  if(action!=='create'||!dialog.querySelector('[data-run-title]').reportValidity())return;
  s.pending??={workspaceId:s.workspaceId,sourceId:s.sourceId,id:s.id,expectedRevision:s.revision,title:s.title};remember(s);s.busy=true;s.error='';paint();
  try{await created(s,await api('/api/research/records/runs/create',s.pending,{adopt:false}));}
  catch(error){if(active(s)){s.error=error.message;if(['INVALID','RECORD_CHANGED','WORKSPACE_CHANGED','MISSING','FORMAT'].includes(error.code)){s.pending=null;s.stale=error.code==='RECORD_CHANGED';if(s.stale)s.revision=null;forget(s);}}}
  finally{if(active(s)){s.busy=false;paint();}}
 });
 return {open,checkContext(){if(session&&session.context!==context()){if(!session.pending)forget(session);session=null;dialog.close();dialog.innerHTML='';}}};
}
