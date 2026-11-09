import {t} from './i18n/index.js';
import {materialReferenceKey} from './material-reference.js';
import {browserHash} from './evidence-fingerprint.js';
import {revisionText} from './revision-model.js';
const tr=(key,args)=>t('scientificEditors',key,args);

// Each open editor owns one acknowledged revision. A second window gets a
// distinct draft until it explicitly chooses to resume this one.
export function scientificEditRecovery({request,scope,esc}){
 let active=null,pendingRestore=null,view=null,rows=[],next=null;
 function status(session,key){
  if(view?.session!==session)return;
  view.status.textContent=tr(key);
 }
 function begin(kind,base=null){
  detach();
  const restored=pendingRestore;pendingRestore=null;
  if(restored&&(restored.summary.kind!==kind||Boolean(restored.base)!==Boolean(base)||base&&materialReferenceKey(restored.base)!==materialReferenceKey(base)))throw Error(tr('recoveryChanged'));
  active={kind,base:structuredClone(base),...scope(),id:restored?.summary.id??crypto.randomUUID(),revision:restored?.summary.revision??null,accepted:restored?JSON.stringify(restored.value):null,command:restored?.value.command??null,pending:null,uncertain:null,operation:null};
  return restored?.value??null;
 }
 function detach(){
  if(!view)return;
  view.events.abort();clearTimeout(view.timer);
  if(view.session.captured?.view===view)view.session.captured=null;
  view=null;
 }
 function address(session){return {workspaceId:session.workspaceId,recordId:session.recordId,id:session.id,expectedRevision:session.revision};}
 function sameOwner(session){const now=scope();return session.workspaceId===now.workspaceId&&session.recordId===now.recordId&&session.context===now.context;}
 function ready(session){if(!session||!sameOwner(session))throw Error(tr('recoveryChanged'));}
 async function remember(){
  if(!view)return;
  const {session,capture}=view;ready(session);
  const ticket=++view.captureEpoch,current=view,edit=current.edit,value=await capture();if(view!==current||ticket!==current.captureEpoch)return;
  if(session.command)value.command=session.command;
  const wire=JSON.stringify(value);
  session.captured={view:current,edit,wire};
  if(wire===session.accepted&&!session.operation&&!session.uncertain){session.pending=null;return;}
  session.pending={wire,value:structuredClone(value)};
 }
 async function commit(session){
  ready(session);
  if(session.operation)return session.operation;
  const run=async()=>{
   while(session.uncertain||session.pending){
    ready(session);const pending=session.uncertain??session.pending;
    if(pending.wire!==session.accepted){
     // A response can be lost after storage commits. Replay that exact write
     // with its original base before sending any newer edits in this window.
     const retry=session.uncertain===pending;
     session.uncertain=pending;
     let result;
     try{result=await request('scientific-draft-write',{...address(session),kind:session.kind,base:session.base,value:pending.value});}
     catch(error){
      // A definite first refusal leaves nothing to retire on discard. If an
      // earlier response was lost, its write must still be reconciled.
      if(!retry&&['STORAGE_FULL','ENOSPC','EDQUOT','DRAFT_SIZE_LIMIT','INVALID'].includes(error?.code))session.uncertain=null;
      throw error;
     }
     ready(session);session.revision=result.revision;session.accepted=pending.wire;session.uncertain=null;
    }
    if(session.pending===pending)session.pending=null;
   }
   const captured=session.captured;
   if(session.revision&&captured&&captured.view===view&&view.edit===captured.edit&&session.accepted===captured.wire)status(session,'recoverySaved');
  };
  const job=run();session.operation=job;
  try{return await job;}catch(error){status(session,'recoveryFailed');throw error;}finally{if(session.operation===job)session.operation=null;}
 }
 async function flush(){
  const current=view;if(!current)return;
  let edit;
  do{
   edit=current.edit;clearTimeout(current.timer);await remember();await commit(current.session);
  }while(view===current&&edit!==current.edit);
 }
 function mount(form,capture){
  if(!active||!form)return;
  detach();const session=active,events=new AbortController();
  const panel=document.createElement('div');panel.className='inline-actions';panel.dataset.scientificRecovery='';
  panel.innerHTML='<p role="status" aria-live="polite"></p><button type="button" class="button" data-action="material-recovery-keep">'+esc(tr('recoveryKeep'))+'</button>';
  form.after(panel);view={form,session,capture,status:panel.querySelector('p'),timer:null,events,captureEpoch:0,edit:0};
  if(session.revision)status(session,'recoverySaved');
  const queue=event=>{
   const current=view;if(!current||current.session!==session||!form.isConnected)return;session.touched=true;current.edit++;
   if(event?.type==='input'||event?.type==='change')session.command=null;
   clearTimeout(current.timer);status(session,'recoveryPending');
   current.timer=setTimeout(()=>{if(current!==view)return;void remember().then(()=>commit(session)).catch(()=>status(session,'recoveryFailed'));},300);
  };
  form.addEventListener('input',queue,{signal:events.signal});
  form.addEventListener('change',queue,{signal:events.signal});
  form.addEventListener('click',event=>{if(event.target.closest('button'))queue();},{signal:events.signal});
  // Paging can replace this form before its debounce fires. The workbench
  // captures the earlier page into its typed model before mounting the next.
  if(session.touched)queue();
 }
 async function checkpoint(command){
  if(!view)return null;
  const session=view.session;
  if(command)session.command=await browserHash(revisionText(command));
  await flush();return address(session);
 }
 async function keep(){
  const current=view;if(!current)return;
  await flush();
  if(view!==current)throw Error(tr('recoveryChanged'));
  current.form.closest('dialog')?.close();
 }
 async function discard(form){
  if(form&&view?.form!==form)return;
  const session=active;if(!session)return;
  if(view)clearTimeout(view.timer);
  if(session.operation)await session.operation.catch(()=>{});
  // Discard unsubmitted changes. Resolve only the outstanding acknowledgement
  // so that a committed first write cannot survive an explicit discard.
  session.pending=null;
  if(session.uncertain)await commit(session);
  if(session.revision){ready(session);await request('scientific-draft-discard',address(session));}
  detach();active=null;
 }
 async function list({more=false}={}){
  const owner=scope(),page=await request('scientific-draft-list',{workspaceId:owner.workspaceId,recordId:owner.recordId,cursor:more?next:null});
  ready(owner);rows=page.items;next=page.next;
  if(!rows.length)return '';
  return '<section><h3>'+esc(tr('recoveryHeading'))+'</h3><ul>'+rows.map(row=>'<li>'+esc(tr('recovery-'+row.kind))+' · '+esc(new Date(row.updatedAt).toLocaleString())+' <button type="button" class="button" data-action="material-recovery-open" data-id="'+esc(row.id)+'">'+esc(tr('recoveryOpen'))+'</button></li>').join('')+'</ul>'+(next?'<button type="button" class="button" data-action="material-recovery-more">'+esc(tr('recoveryMore'))+'</button>':'')+'</section>';
 }
 async function restore(summary,open,showOutcome){
  const owner=scope();if(owner.workspaceId!==summary.owner.workspaceId||owner.recordId!==summary.owner.recordId)throw Error(tr('recoveryChanged'));
  const result=await request('scientific-draft-read',{workspaceId:owner.workspaceId,recordId:owner.recordId,id:summary.id,expectedRevision:summary.revision});
  ready(owner);if(result.summary.state==='retained'&&showOutcome)return showOutcome(result);
  if(!result.summary.capabilities.recover)throw Error(tr('recoveryChanged'));
  pendingRestore=result;
  try{await open(result.summary.kind,result.base,result.value);if(pendingRestore)throw Error(tr('recoveryChanged'));}
  finally{pendingRestore=null;}
 }
 const isActive=()=>Boolean(view?.form.isConnected&&view.form.closest('dialog')?.open);
 return {begin,mount,detach,flush,keep,checkpoint,discard,list,restore,pendingForm:()=>active?.touched&&isActive()?view.form:null,owns:form=>view?.form===form,find:id=>rows.find(item=>item.id===id),isActive,isKind:kind=>isActive()&&active?.kind===kind&&sameOwner(active),reset(){detach();active=null;pendingRestore=null;rows=[];next=null;}};
}
