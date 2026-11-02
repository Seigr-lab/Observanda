import {AppError} from './errors.js';
import {backgroundWriterWait} from './writer-wait.js';
import {withDatabaseRequest} from './database-request-context.js';
import {independentDiagnostics,diagnosticPhase} from './operational-diagnostics.js';
import {upgradeExistingWebsites,websiteUpgradeStatus} from './website-files-migration.js';

// Preparation belongs to the authenticated workspace lifetime. Closing the
// dashboard or opening the editor must not cancel a committed storage upgrade.
export class WorkspaceWebsitePreparation{
 constructor(workspace){this.workspace=workspace;this.clients=new WeakSet();}
 status(){return this.progress??websiteUpgradeStatus(this.workspace);}
 start(client,{prepare,check}){
  if(this.task||this.progress?.state==='ready'||this.clients.has(client))return;
  this.clients.add(client);
  const controller=new AbortController(),{signal}=controller;
  this.controller=controller;this.progress={state:'preparing',total:0,done:0};
  this.task=independentDiagnostics(()=>diagnosticPhase('website-storage-upgrade',()=>
   withDatabaseRequest(signal,()=>backgroundWriterWait(async()=>{
    const saved=await websiteUpgradeStatus(this.workspace,{signal});
    if(saved.state==='ready'){this.progress=saved;return;}
    await check();
    const result=await prepare(options=>upgradeExistingWebsites(this.workspace,{...options,signal,onProgress:value=>{this.progress=value;}}));
    this.progress=result;
    if(result.state==='failed')throw new AppError(result.code);
   },{signal,check}))
  )).catch(error=>{
   if(!signal.aborted&&this.progress?.state!=='failed')this.progress={state:'failed',code:error instanceof AppError?error.code:'IO'};
  }).finally(()=>{this.task=null;});
 }
 async stop(){this.controller?.abort();await this.task;}
}
