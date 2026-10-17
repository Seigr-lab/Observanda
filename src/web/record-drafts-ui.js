import {recordDraftList} from './record-draft-list.js';
import {writeRecordCheckpoint} from './record-draft-transfer.js';
import {recordCheckpointIdentity} from './record-checkpoint-identity.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordDrafts',key,args);
// Writer identities stay in browser memory. Research checkpoints are stored
// through the authenticated workspace writer, never in browser local storage.
export function recordDraftsUI({api,esc,snapshot,onChange,onReset,recover,recoverWriting,recoverValue,recoverDocument,notify,compact=()=>false}){
  let writer=null,generation=0,editVersion=0,timer=null,queue=Promise.resolve(),message='',failed=false,last='',checkpointTime='',pendingSave=null;
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
    writer=workspaceId?{id:crypto.randomUUID(),workspaceId,revision:null}:null;pendingSave=null;last='';checkpointTime='';message='';failed=false;
    await list.reset(writer);
  }
  function schedule(){
    if(!writer)return;
    editVersion++;
    status(text('pending'));
    if(!timer)timer=setTimeout(()=>{timer=null;flush();},800);
  }
  const refused=error=>['INVALID','FORMAT','LIMIT','RECORD_SIZE_LIMIT','DRAFT_SIZE_LIMIT','RECORD_COMMAND_LIMIT'].includes(error.code);
  const changedOwner=()=>Object.assign(Error(text('workspaceChanged')),{code:'WORKSPACE_CHANGED'});
  // Resolve an uncertain transfer first, then write the exact requested value.
  // The retained receipt is an acknowledgement of those bytes, not current typing.
  async function checkpoint(owner,data,epoch){
    const hash=(await recordCheckpointIdentity(data)).sha256;
    const request=(...args)=>{if(epoch!==generation)throw changedOwner();return api(...args);};
    if(owner.pending){
      const sent=owner.pending,result=await writeRecordCheckpoint(request,sent,{adopt:false});
      owner.revision=result.revision;owner.hash=(await recordCheckpointIdentity(sent.changes)).sha256;owner.receipt=result;owner.pending=null;
    }
    if(epoch!==generation)throw changedOwner();
    if(owner.hash!==hash){
      owner.pending={id:owner.id,workspaceId:owner.workspaceId,expectedRevision:owner.revision,changes:data};
      const result=await writeRecordCheckpoint(request,owner.pending,{adopt:false});
      owner.revision=result.revision;owner.hash=hash;owner.receipt=result;owner.pending=null;
    }
    return {...owner.receipt,id:owner.id,workspaceId:owner.workspaceId,revision:owner.revision,changes:data,hash};
  }
  function checkpointFailure(error,owner,epoch){
    if(epoch!==generation)return;
    if(refused(error))owner.pending=null;
    if(error.code==='DRAFT_CHANGED'&&writer===owner){
      writer={id:crypto.randomUUID(),workspaceId:owner.workspaceId,revision:null};last='';void list.reset(writer);
    }
    status(error.message?text('notCheckpointedReason',{reason:error.message}):text('notCheckpointed'),true);
  }
  async function flush({required=false}={}){
    clearTimeout(timer);timer=null;const epoch=generation;
    return enqueue(async()=>{
      if(epoch!==generation){if(required)throw changedOwner();return;}
      const owner=writer;if(!owner)return null;
      const data=wire(snapshot());if(!data)return null;
      try{
        const captured=(await recordCheckpointIdentity(data)).sha256;
        // The pending Save already protects these exact bytes. Newer typing may
        // use the new writer, but may never replace the submitted checkpoint.
        if(pendingSave?.hash===captured)return pendingSave.receipt??null;
        status(text('saving'));
        const receipt=await checkpoint(owner,data,epoch);
        if(epoch!==generation){if(required)throw changedOwner();return;}
        last=captured;checkpointTime=text('checkpointed',{time:new Date(receipt.updatedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})});status(checkpointTime);
        const current=await fingerprint();if(epoch===generation&&current!==captured&&snapshot())schedule();
        return receipt;
      }catch(error){checkpointFailure(error,owner,epoch);if(required)throw error;return null;}
    });
  }
  async function commit(changes,{baseRevision=null}={}){
    clearTimeout(timer);timer=null;const epoch=generation;
    return enqueue(async()=>{
      if(epoch!==generation||!writer)throw changedOwner();
      // Never prepare again after an unknown apply outcome: its saved plan is
      // the durable replay identity even after the original checkpoint is gone.
      if(pendingSave?.rejected)pendingSave={owner:pendingSave.owner,changes:wire(changes),baseRevision,plan:null,saved:null};
      const operation=pendingSave??={owner:writer,changes:wire(changes),baseRevision,plan:null,saved:null};
      try{
        if(!operation.receipt){
          status(text('saving'));
          operation.receipt=await checkpoint(operation.owner,operation.changes,epoch);operation.hash=operation.receipt.hash;
          if(epoch!==generation)throw changedOwner();
          if(writer===operation.owner){writer={id:crypto.randomUUID(),workspaceId:operation.owner.workspaceId,revision:null};last='';checkpointTime='';await list.reset(writer);}
        }
        const request=(route,data)=>{if(epoch!==generation)throw changedOwner();return api('/api/research/drafts/review/'+route,data,{adopt:false});};
        const source={id:operation.receipt.id,workspaceId:operation.receipt.workspaceId,expectedRevision:operation.receipt.revision};
        operation.plan??=await request('prepare',source);
        const plan=operation.plan,id=operation.changes[0]?.record?.id;
        if(plan.workspaceId!==source.workspaceId||plan.recordId!==id||!revisionId(plan.id)||!revisionId(plan.revision)||plan.count!==0||plan.storageRevision!==operation.baseRevision||(operation.baseRevision===null&&!plan.newRecord))throw Object.assign(Error(text('saveChanged')),{code:'RECORD_CHANGED'});
        if(!operation.saved){operation.applyAttempted=true;operation.saved=await request('apply',{id:plan.id,workspaceId:plan.workspaceId,expectedRevision:plan.revision});}
        if(epoch!==generation)throw changedOwner();
        if(!operation.saved.recordDraftRecovered||operation.saved.recordId!==id||operation.saved.absent||!revisionId(operation.saved.etag))throw Object.assign(Error(text('invalidPage')),{code:'FORMAT'});
        return {saved:operation.saved,changes:operation.changes};
      }catch(error){
        if(!operation.saved&&['RECORD_CHANGED','DRAFT_CHANGED'].includes(error.code))operation.applyAttempted=false;
        if(refused(error)&&!operation.saved){operation.owner.pending=null;operation.rejected=true;operation.applyAttempted=false;error.checkpointRejected=true;}
        if(epoch===generation)status(text('savePending',{reason:error.message??text('notCheckpointed')}),true);
        throw error;
      }
    });
  }
  // The caller has authenticated the committed header and adopted the exact
  // base. Newer edits still belong to the separate current checkpoint writer.
  function acknowledge(){pendingSave=null;last='';}
  async function clear(){
    clearTimeout(timer);timer=null;
    const epoch=generation;
    return enqueue(async()=>{
      const owner=writer;
      if(!owner||epoch!==generation)return;
      try{
        // Discard must not abandon a Save with an unknown commit outcome.
        if(pendingSave?.applyAttempted)throw Object.assign(Error(text('saveUncertain')),{code:'RECORD_CHANGED'});
        if(pendingSave){
          const abandoned=pendingSave.owner;
          if(abandoned.pending&&!pendingSave.rejected)await checkpoint(abandoned,pendingSave.changes,epoch);
          if(abandoned.revision)await api('/api/research/drafts/remove',{id:abandoned.id,workspaceId:abandoned.workspaceId,expectedRevision:abandoned.revision},{adopt:false});
          if(abandoned===owner){owner.revision=null;owner.pending=null;owner.hash=null;owner.receipt=null;}
          pendingSave=null;
        }
        // A record may have saved after a checkpoint response was lost. Resolve
        // that exact write before deletion so it cannot become an orphan.
        if(owner.pending){const result=await writeRecordCheckpoint(api,owner.pending);owner.revision=result.revision;owner.pending=null;}
        if(!owner.revision){status('');await list.refresh();return;}
        await api('/api/research/drafts/remove',{id:owner.id,workspaceId:owner.workspaceId,expectedRevision:owner.revision});
        if(epoch!==generation)return;
        writer={id:crypto.randomUUID(),workspaceId:owner.workspaceId,revision:null};last='';status('');await list.reset(writer);
      }catch(error){
        if(epoch!==generation)return;
        if(pendingSave)throw error;
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
  return {start,schedule,flush,commit,acknowledge,hasPendingSave:()=>!!pendingSave,saveUncertain:()=>!!pendingSave?.applyAttempted,clear,banner,statusView,update,refresh:list.refresh,isRecovering:list.isBusy,close(){list.close();void start(null);},pause(){clearTimeout(timer);timer=null;status(text('paused'));}};
}
