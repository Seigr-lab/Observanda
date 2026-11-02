import {AppError} from './errors.js';
import {backgroundWriterWait} from './writer-wait.js';
import {withDatabaseRequest} from './database-request-context.js';
import {independentDiagnostics,diagnosticPhase} from './operational-diagnostics.js';
import {upgradeExistingWebsites,websiteUpgradeStatus} from './website-files-migration.js';
import {WebsiteFileStore} from './website-file-store.js';
import {lastWebsiteLibraryDiscovery} from './website-library-discovery.js';

// Preparation belongs to the authenticated workspace lifetime. Closing the
// dashboard or opening the editor must not cancel a committed storage upgrade.
export class WorkspaceWebsitePreparation{
 constructor(workspace){this.workspace=workspace;this.clients=new WeakSet();}
 async status(){
  const progress=this.progress??await websiteUpgradeStatus(this.workspace);
  const library=this.library??(progress.state==='ready'?await lastWebsiteLibraryDiscovery(new WebsiteFileStore(this.workspace)):null);
  return library?{...progress,library}:progress;
 }
 start(client,options){
  const {prepare,check,discover,retry=false}=options;
  if(this.clients.has(client)&&!retry)return;
  if(this.task){this.next=[client,options];return;}
  this.clients.add(client);
  const controller=new AbortController(),{signal}=controller;
  this.controller=controller;
  this.task=independentDiagnostics(()=>diagnosticPhase('website-storage-upgrade',()=>
   withDatabaseRequest(signal,()=>backgroundWriterWait(async()=>{
    const saved=await websiteUpgradeStatus(this.workspace,{signal});
    this.progress=saved;
    await check();
    if(saved.state!=='ready'){
     this.progress={state:'preparing',total:0,done:0};
     const result=await prepare(options=>upgradeExistingWebsites(this.workspace,{...options,signal,onProgress:value=>{this.progress=value;}}));
     this.progress=result;
     if(result.state==='failed')throw new AppError(result.code);
    }
    if(discover){
     this.library={state:'preparing'};
     try{this.library=await discover({signal});}
     catch(error){if(!signal.aborted)this.library={state:'failed',code:error instanceof AppError?error.code:'IO'};}
    }
   },{signal,check}))
  )).catch(error=>{
   if(!signal.aborted&&!['failed','ready'].includes(this.progress?.state))this.progress={state:'failed',code:error instanceof AppError?error.code:'IO'};
  }).finally(()=>{this.task=null;const next=this.next;this.next=null;if(next&&!signal.aborted)this.start(...next);});
 }
 async stop(){this.controller?.abort();await this.task;}
}
