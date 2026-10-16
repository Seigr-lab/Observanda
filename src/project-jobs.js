import {ComparisonJobAccess} from './comparison-job-access.js';
import {ProjectPublications} from './project-publications.js';
import {PublicationSourceAccess} from './publication-source-access.js';
import {AsyncLocalStorage} from 'node:async_hooks';
// Background evidence work owns a key for its full lifetime. HTTP request keys
// can be cleared as soon as the response finishes without stopping the worker.
import {ProjectStorage} from './project-storage.js';
import {LabBookStorage} from './lab-book-storage.js';
import {researchId} from './web/research-reference.js';
import {DurableJobs,JobWorker} from './jobs.js';
import {workspaceJobDefinitions} from './workspace-jobs.js';
import {Publisher} from './publishing.js';
import {cloneVault,clearVault} from './encryption.js';
import {withDatabaseRequest} from './database-request-context.js';
import {withoutWriterWait} from './writer-wait.js';
import {AppError} from './errors.js';
const releasing=new AsyncLocalStorage();
class AuthorizedJobs extends DurableJobs{
 constructor(storage,definitions,check){super(storage,definitions);this.check=check;}
 async claim(){await this.check();return super.claim();}
 transaction(operation){const releasingLease=releasing.getStore()===this;return super.transaction(async()=>{if(!releasingLease)await this.check();return operation();});}
 release(id,token,options){return options?.paused?releasing.run(this,()=>super.release(id,token,options)):super.release(id,token,options);}
}
class ProjectWorker extends JobWorker{
 wake(){return withoutWriterWait(()=>withDatabaseRequest(undefined,()=>super.wake()));}
}
export class ProjectJobs{
 constructor({publisherOptions=()=>({})}={}){this.publisherOptions=publisherOptions;this.comparisonAccess=new ComparisonJobAccess();this.sessions=new WeakMap();this.entries=new Set();this.stopping=new Set();this.closed=false;}
 stop(entry){
  if(entry.stopped)return entry.stopped;entry.closed=true;entry.sourceAccess?.clear();entry.publications?.clear();this.entries.delete(entry);
  const pending=entry.worker.stop().then(async()=>{entry.publisher.token=null;await entry.publisher.connection?.cancel();}).finally(()=>{clearVault(entry.storage.vault);entry.grant?.close();this.stopping.delete(pending);});
  this.stopping.add(pending);entry.stopped=pending;return pending;
 }
 async forget(session,id){const owners=this.sessions.get(session);if(!owners)return;const pending=[];for(const [key,entry] of owners)if(entry.projectId===id){owners.delete(key);pending.push(this.stop(entry));}await Promise.all(pending);}
 async forgetBook(session,projectId,labBookId){const owners=this.sessions.get(session),key='book:'+projectId+':'+labBookId,entry=owners?.get(key);if(entry){owners.delete(key);await this.stop(entry);}}
 async invalidateBook(projectId,labBookId){await Promise.all([...this.entries].filter(entry=>entry.projectId===projectId&&entry.storage.labBookId===labBookId).map(entry=>this.stop(entry)));}
 async invalidateProject(id){await Promise.all([...this.entries].filter(entry=>entry.projectId===id).map(entry=>this.stop(entry)));}
 expire(now=Date.now()){for(const entry of this.entries)if(entry.expires<=now)void this.stop(entry).catch(()=>{});}
 async close(){this.closed=true;this.comparisonAccess.clear();await Promise.all([...this.entries].map(entry=>this.stop(entry)));await Promise.all(this.stopping);this.sessions=new WeakMap();}
 async owner(session,storage,etag,check,{projectId=storage.projectId,retain}={}){
  const book=storage.labBookId!==undefined;if(!researchId(projectId)||book&&(!researchId(storage.labBookId)||storage.projectId!==undefined||typeof retain!=='function'))throw new AppError('INVALID');
  const key=book?'book:'+projectId+':'+storage.labBookId:projectId;
  if(this.closed)throw new AppError('ACCESS_LOCKED');await check();if(this.closed)throw new AppError('ACCESS_LOCKED');
  let owners=this.sessions.get(session);if(!owners){owners=new Map();this.sessions.set(session,owners);}
  let entry=owners.get(key);
  if(entry&&(entry.closed||entry.storage.root!==storage.root||entry.etag!==etag||entry.expires<=Date.now())){owners.delete(key);await this.stop(entry);entry=null;}
  if(!entry){
   const owned=book?new LabBookStorage(storage.root,storage.labBookId,cloneVault(storage.vault)):new ProjectStorage(storage.root,storage.projectId,cloneVault(storage.vault));
   let grant;
   try{grant=retain?await retain():null;await (grant?.check??check)();}
   catch(error){grant?.close();clearVault(owned.vault);throw error;}
   entry={storage:owned,projectId,grant,routePrefix:'/api/projects/'+projectId+(book?'/lab-books/'+storage.labBookId:''),etag,expires:Date.now()+8*60*60*1000,closed:false};
   try{
   const current=()=>entry.queue;entry.sourceAccess=new PublicationSourceAccess();entry.comparisonAccess=this.comparisonAccess;
   entry.publisher=new Publisher(owned.root,{...this.publisherOptions(owned),workspace:owned},owned.vault);
   entry.queue=new AuthorizedJobs(owned,workspaceJobDefinitions(owned,entry.publisher,current,{sourceAccess:entry.sourceAccess,comparisonAccess:this.comparisonAccess}),async()=>{
    try{if(entry.closed||entry.expires<=Date.now())throw new AppError('ACCESS_LOCKED');await (entry.grant?.check??check)();}catch(error){if(['ACCESS_LOCKED','WORKSPACE_CHANGED','NOT_FOUND','STORAGE_DELETING','STORAGE_MOVING'].includes(error.code))void this.stop(entry).catch(()=>{});throw error;}
   });
   entry.worker=new ProjectWorker(entry.queue);entry.publications=new ProjectPublications(entry);owners.set(key,entry);this.entries.add(entry);
   }catch(error){grant?.close();clearVault(owned.vault);throw error;}
  }
  entry.expires=Date.now()+8*60*60*1000;
  // A request's abort signal, writer queue and response activity do not belong
  // to a durable worker that outlives that request.
  withoutWriterWait(()=>withDatabaseRequest(undefined,()=>entry.worker.start()));return entry;
 }
}
