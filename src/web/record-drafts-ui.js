import {recordDraftList} from './record-draft-list.js';
import {writeRecordCheckpoint} from './record-draft-transfer.js';
import {recordCheckpointIdentity} from './record-checkpoint-identity.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordDrafts',key,args);
// Writer identities stay in browser memory. Research checkpoints are stored
// through the authenticated workspace writer, never in browser local storage.
export function recordDraftsUI({api,esc,snapshot,onChange,onReset,recover,recoverWriting,recoverValue,recoverDocument,notify,compact=()=>false}){
  let writer=null,generation=0,editVersion=0,timer=null,queue=Promise.resolve(),message='',failed=false,last='',checkpointTime='';
  const wire=changes=>compact()&&changes?.length===1?changes.map(({base,...change})=>({...change,baseRevision:change.expectedRevision})):changes;
  const fingerprint=async()=> (await recordCheckpointIdentity(wire(snapshot()))).sha256;
  const list=recordDraftList({api,esc,onChange,recover,recoverWriting,recoverValue,recoverDocument,notify,checkpoint:async()=>{
    const epoch=generation;last='';await flush();const version=editVersion,current=await fingerprint();
    return epoch===generation&&version===editVersion&&!failed&&Boolean(writer?.revision)&&last===current;
  }});
  function status(text,error=false){message=text;failed=error;onChange();}
  function enqueue(operation){const task=queue.then(operation);queue=task.catch(()=>{});return task;}
  async function start(workspaceId){
    onReset?.();
    clearTimeout(timer);timer=null;generation++;editVersion=0;
    writer=workspaceId?{id:crypto.randomUUID(),workspaceId,revision:null}:null;last='';checkpointTime='';message='';failed=false;
    await list.reset(writer);
  }
  function schedule(){
    if(!writer)return;
    editVersion++;
    status(text('pending'));
    if(!timer)timer=setTimeout(()=>{timer=null;flush();},800);
  }
  async function flush(){
    clearTimeout(timer);timer=null;
    const epoch=generation;
    return enqueue(async()=>{
      if(epoch!==generation)return;
      const owner=writer;if(!owner)return;
      const data=owner.pending?.changes??wire(snapshot());if(!data)return;
      status(text('saving'));
      try{
        const captured=(await recordCheckpointIdentity(data)).sha256;
        if(epoch!==generation)return;
        if(captured===last&&!owner.pending){status(checkpointTime);return;}
        owner.pending??={id:owner.id,workspaceId:owner.workspaceId,expectedRevision:owner.revision,changes:data};
        const result=await writeRecordCheckpoint(api,owner.pending);
        owner.revision=result.revision;owner.pending=null;
        if(epoch!==generation)return;
        last=captured;checkpointTime=text('checkpointed',{time:new Date(result.updatedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})});status(checkpointTime);
        const current=await fingerprint();
        if(epoch===generation&&current!==captured&&snapshot())schedule();
      }catch(error){
        if(epoch!==generation)return;
        // A confirmed validation refusal did not write a checkpoint. Let the
        // corrected editor state replace that rejected request; unknown delivery
        // outcomes must still retry the exact pending request first.
        if(['INVALID','FORMAT','LIMIT','RECORD_SIZE_LIMIT','DRAFT_SIZE_LIMIT','RECORD_COMMAND_LIMIT'].includes(error.code))owner.pending=null;
        if(error.code==='DRAFT_CHANGED'){
          // Another editor recovered this checkpoint. Leave that version alone
          // and keep this window's work in a new independent checkpoint.
          writer={id:crypto.randomUUID(),workspaceId:owner.workspaceId,revision:null};last='';void list.reset(writer);
        }
        status(error.message?text('notCheckpointedReason',{reason:error.message}):text('notCheckpointed'),true);
      }
    });
  }
  async function clear(){
    clearTimeout(timer);timer=null;
    const epoch=generation;
    return enqueue(async()=>{
      const owner=writer;
      if(!owner||epoch!==generation)return;
      try{
        // A record may have saved after a checkpoint response was lost. Resolve
        // that exact write before deletion so it cannot become an orphan.
        if(owner.pending){const result=await writeRecordCheckpoint(api,owner.pending);owner.revision=result.revision;owner.pending=null;}
        if(!owner.revision){status('');return;}
        await api('/api/research/drafts/remove',{id:owner.id,workspaceId:owner.workspaceId,expectedRevision:owner.revision});
        if(epoch!==generation)return;
        writer={id:crypto.randomUUID(),workspaceId:owner.workspaceId,revision:null};last='';status('');await list.reset(writer);
      }catch{
        if(epoch!==generation)return;
        // The saved record is durable. Keep the leftover checkpoint discoverable
        // and start the next edit with a separate writer identity.
        writer={id:crypto.randomUUID(),workspaceId:owner.workspaceId,revision:null};last='';
        status(text('removeFailed'),true);await list.reset(writer);
      }
    });
  }
  const banner=()=>list.banner(failed?message:'');
  function statusView(){return `<span class="record-draft-status" data-record-checkpoint data-error="${failed}">${esc(message)}</span><button class="button subtle" data-record-draft-retry ${failed?'':'hidden'}>${esc(text('retryCheckpoint'))}</button>`;}
  function update(){
    const bannerElement=document.querySelector('#record-draft-banner');
    if(bannerElement){
      const focused=bannerElement.contains(document.activeElement);bannerElement.outerHTML=banner();
      if(focused)document.querySelector('[data-record-drafts]')?.focus({preventScroll:true});
    }
    const label=document.querySelector('[data-record-checkpoint]');if(label){label.textContent=message;label.dataset.error=String(failed);}
    const retry=document.querySelector('[data-record-draft-retry]');if(retry)retry.hidden=!failed;
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-record-draft-retry]'))flush();
  });
  // Flushing on backgrounding is best effort. The UI states when a checkpoint
  // actually reached storage; beforeunload still protects unsaved research.
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();});
  window.addEventListener('online',()=>{if(failed)flush();});
  return {start,schedule,flush,clear,banner,statusView,update,refresh:list.refresh,isRecovering:list.isBusy,close(){list.close();void start(null);},pause(){clearTimeout(timer);timer=null;status(text('paused'));}};
}
