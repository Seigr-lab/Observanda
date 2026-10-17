import {activityOwner} from './web/activity-owner.js';
import {randomUUID} from 'node:crypto';
import {AppError,safeError} from './errors.js';
const failure=error=>{const {code,message}=safeError(error);return {code,message};};

// Read-only observations belong to the service, not a browser response or the
// workspace writer. Results, command inputs and credentials never enter here.
export class OperationActivity{
 constructor(){this.entries=new Map();this.failureSequence=0;}
 begin(scope,kind,{view,recoveryKey=null}={}){
  if(typeof recoveryKey!=='string'||!/^[-a-z]{1,48}:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(recoveryKey))recoveryKey=null;
  const now=Date.now(),entry={id:randomUUID(),scope,kind,recoveryKey,view:activityOwner(kind,view),state:'running',startedAt:now,updatedAt:now,progress:{stage:'preparing',completed:0,unit:'items',advancedAt:now}};
  if(recoveryKey)for(const previous of this.entries.values())if(previous.scope===scope&&previous.recoveryKey===recoveryKey&&previous.state==='failed'&&!previous.resolvedAt)previous.supersededBy=entry.id;
  this.entries.set(entry.id,entry);let resumeProgress=null;
  return {
   waiting:()=>{if(entry.state!=='queued')resumeProgress=structuredClone(entry.progress);entry.state='queued';entry.progress.stage='waiting-writer';entry.updatedAt=Date.now();},
   running:stage=>{entry.state='running';if(stage!==undefined)entry.progress.stage=stage;else if(entry.progress.stage==='waiting-writer'&&resumeProgress)entry.progress=resumeProgress;resumeProgress=null;entry.updatedAt=Date.now();},
   remove:()=>this.entries.delete(entry.id),
   progress:value=>{
    if(value.stage!=='preparing'||entry.progress.stage==='preparing'){
     const completed=value.completed??value.loaded??0,changed=value.stage!==entry.progress.stage||completed!==entry.progress.completed;
     entry.progress={...structuredClone(value),completed,unit:value.unit??'items',advancedAt:value.advancedAt??(changed?Date.now():entry.progress.advancedAt)};
    }
    entry.updatedAt=Date.now();
   },
   finish:error=>{if(entry.finishedAt)return;entry.state=['WRITE_CANCELLED','RECORD_TRANSFER_CANCELLED'].includes(error?.code)?'cancelled':error?'failed':'completed';entry.updatedAt=Date.now();entry.finishedAt=entry.updatedAt;if(error)entry.error=failure(error);if(entry.state==='failed')this.failureSequence++;
    if(!error&&entry.recoveryKey)for(const previous of this.entries.values()){if(previous===entry)break;if(previous.scope===entry.scope&&previous.recoveryKey===entry.recoveryKey&&previous.state==='failed')previous.resolvedAt=entry.finishedAt;}
   }
  };
 }
 job(scope,job){
  const id='job:'+job.id,previous=this.entries.get(id),now=Date.now(),stage=job.progress.stage;
  const changed=!previous||previous.progress.stage!==stage||previous.progress.completed!==job.progress.done||previous.state!==job.state;
  if(job.state==='failed'&&previous?.state!=='failed')this.failureSequence++;
  this.entries.set(id,{id,scope,kind:'job:'+job.type,state:job.state,startedAt:previous?.startedAt??now,updatedAt:now,
   ...(['completed','failed','cancelled'].includes(job.state)?{finishedAt:now}:{}),
   progress:{stage,completed:job.progress.done,...(job.progress.total>0?{total:job.progress.total}:{}),unit:job.progress.unit??'items',advancedAt:changed?now:previous.progress.advancedAt},
   ...(job.error?{error:failure(new AppError(job.error))}:{})});
 }
 relocate(from,to){for(const entry of this.entries.values())if(entry.scope===from&&entry.state==='running')entry.scope=to;}
 list(scope){const now=Date.now();return [...this.entries.values()].filter(entry=>entry.scope===scope).map(({scope,recoveryKey,...entry})=>({...entry,...(recoveryKey?{commandId:recoveryKey.split(':')[1]}:{}),progress:{...structuredClone(entry.progress),elapsedMs:(entry.finishedAt??now)-entry.startedAt,observedAt:entry.finishedAt??now}}));}
 clear(scope){for(const [id,entry] of this.entries)if(entry.scope===scope&&!['queued','running'].includes(entry.state))this.entries.delete(id);}
}
