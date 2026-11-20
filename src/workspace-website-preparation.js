import {AppError} from './errors.js';
import {backgroundWriterWait} from './writer-wait.js';
import {withDatabaseRequest} from './database-request-context.js';
import {independentDiagnostics,diagnosticPhase} from './operational-diagnostics.js';
import {WebsiteFileStore} from './website-file-store.js';
import {lastWebsiteLibraryDiscovery} from './website-library-discovery.js';

// Preparation belongs to the authenticated workspace lifetime: it discovers
// the lab book records shared for websites, so the website editor's library
// can offer them. Closing the dashboard or opening the editor does not cancel it.
export class WorkspaceWebsitePreparation{
 // An activity entry shows the preparation in the app's activity surface; the
 // durable upgrade journals let a cancelled or interrupted preparation resume.
 constructor(workspace,{activity}={}){this.workspace=workspace;this.clients=new WeakSet();this.activity=activity;this.cancelled=false;}
 async status(){
  const progress=this.progress??{state:'ready',total:0,done:0};
  if(this.cancelled&&!['ready','failed'].includes(progress.state))return {...progress,state:'cancelled'};
  const library=this.library??(progress.state==='ready'?await lastWebsiteLibraryDiscovery(new WebsiteFileStore(this.workspace)):null);
  return library?{...progress,library}:progress;
 }
 start(client,options){
  const {check,discover,retry=false}=options;
  if(this.clients.has(client)&&!retry)return;
  if(this.task){this.next=[client,options];return;}
  this.clients.add(client);this.cancelled=false;
  const controller=new AbortController(),{signal}=controller;
  this.controller=controller;
  // The activity appears only once there is work to show; an already prepared workspace adds none.
  let entry=null,converting=false;const started=Date.now();
  const report=value=>{if(value.stage!=='discovering-library')converting=true;entry??=this.activity?.()??null;entry?.progress({stage:value.stage??value.phase??'preparing',completed:value.completed??0,...(Number.isSafeInteger(value.stageTotal)?{total:value.stageTotal}:{}),unit:'items'});};
  this.task=independentDiagnostics(()=>diagnosticPhase('website-library-discovery',()=>
   withDatabaseRequest(signal,()=>backgroundWriterWait(async()=>{
    this.progress={state:'preparing',stage:'discovering-library',total:0,done:0};
    await check();
    if(discover){
     this.library={state:'preparing'};report({stage:'discovering-library'});
     try{this.library=await discover({signal});}
     catch(error){
      // A stopped discovery resumes later; until then no library state is claimed.
      if(signal.aborted){this.library=null;throw error;}
      this.library={state:'failed',code:error instanceof AppError?error.code:'IO'};
     }
    }
    this.progress={state:'ready',total:0,done:0};
   },{signal,check}))
  )).then(()=>{if(entry&&!converting&&Date.now()-started<2000)entry.remove();else entry?.finish();},error=>{
   entry?.finish(signal.aborted?new AppError('WRITE_CANCELLED'):error);
   if(!signal.aborted&&!['failed','ready'].includes(this.progress?.state))this.progress={state:'failed',code:error instanceof AppError?error.code:'IO'};
  }).finally(()=>{this.task=null;const next=this.next;this.next=null;if(next&&!signal.aborted)this.start(...next);});
 }
 async stop(){this.controller?.abort();await this.task;}
 // A person can stop preparation; the next resume (or the next opening of the workspace)
 // continues library discovery from its saved position.
 async cancel(){if(!this.task)return this.status();this.cancelled=true;this.next=null;await this.stop();return this.status();}
}
