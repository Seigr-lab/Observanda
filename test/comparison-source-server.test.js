import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {publicationSourceFactory} from '../src/project-publication-sources.js';
import {publicationDependencyState} from '../src/publication-analysis-inputs.js';
import {MaterialIndex} from '../src/material-index.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {initializeLocation} from '../src/locations.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ProjectStorage} from '../src/project-storage.js';
import {Workspace} from '../src/storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectReferenceAliases} from '../src/project-reference-aliases.js';
import {createComparisonSourceAccess} from '../src/comparison-source-access.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankAnalysisMethod,blankAnalysisSource} from '../src/web/analysis-model.js';
import {AnalysisComparisons} from '../src/analysis-comparisons.js';
import {TestDeviceStore} from './device-fixture.js';
async function result(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
function waitFor(promise,signal){
 signal.throwIfAborted();return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason),finish=callback=>value=>{signal.removeEventListener('abort',abort);callback(value);};
  signal.addEventListener('abort',abort,{once:true});promise.then(finish(resolve),finish(reject));
 });
}
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-comparison-source-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[];let app;
 t.after(async()=>{await app?.close();await provider.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-comparison-source-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
 const root=path.join(directory,'Research Workspace'),initial=createNotebook('Research Workspace');await initializeLocation(root,initial,access,vault);const workspace=new Workspace(root,vault),registry=new ProjectRegistry(workspace,initial.id);
 app=await startServer({root,port:0,headless:true,deviceStore:device});
 async function client(){
  const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(session.status,200);const cookie=session.headers.get('set-cookie').split(';')[0],context=(await result(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}}))).contextId;
  const headers={Origin:app.origin,Cookie:cookie,'X-Observanda-Workspace':context};
  return async(route,data)=>{try{return await fetch(app.origin+route,{signal:AbortSignal.any([t.signal,AbortSignal.timeout(30000)]),method:data===undefined?'GET':'POST',headers:{...headers,'Content-Type':'application/json','X-Observanda-Wait':'1'},...(data===undefined?{}:{body:JSON.stringify(data)})});}catch(error){throw new Error('Request failed: '+route,{cause:error});}};
 }
 const call=await client(),projectId=randomUUID(),base='/api/projects/'+projectId;
 const project=(await result(await call('/api/projects/create',{id:randomUUID(),username:'',password:'',project:{id:projectId,title:'Field Project',description:'',share:false,logoId:null}}))).project;
 const book=async title=>(await result(await call(base+'/lab-books/create',{id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId,title}}))).book;
 const a=await book('Measurements'),b=await book('Calculations');
 async function storage(entry,Class,id){const key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:device});vaults.push(key);return new Class(entry.root,id,key);}
 return {directory,device,app,call,client,restart:async()=>{await app.close();app=await startServer({root,port:0,headless:true,deviceStore:device});},initial,workspace,registry,project,projectId,base,a,b,own:base+'/lab-books/'+a.labBookId,other:base+'/lab-books/'+b.labBookId,parent:await storage(project,ProjectStorage,projectId),selected:await storage(a,LabBookStorage,a.labBookId),sibling:await storage(b,LabBookStorage,b.labBookId)};
}
async function completed(call,prefix,id){
 const until=Date.now()+45000;for(;;){const {job}=await result(await call(prefix+'job',{id}));if(['completed','failed','cancelled'].includes(job.state))return job;if(Date.now()>until)assert.fail('Comparison worker did not finish within the test deadline: '+JSON.stringify(job));await new Promise(resolve=>setTimeout(resolve,100));}
}
test('retained comparison sources are read-only, client-bound and survive the initiating HTTP response',{timeout:180000},async t=>{
 const began=Date.now(),mark=phase=>t.diagnostic('Comparison phase '+(Date.now()-began)+'ms: '+phase);mark('create owners');
 const f=await fixture(t),recordId=randomUUID(),source=new ResearchMaterials(f.selected),output=new ResearchMaterials(f.sibling),prefix=f.other+'/research/materials/';
 for(const [route,namespace,book,title] of [[f.own,f.a.namespaceId,f.a.labBookId,'Source observation'],[f.other,f.b.namespaceId,f.b.labBookId,'Comparison observation']]){
  const record={...sampleNotebook().entries[0],id:recordId,notebookId:book,title};await result(await f.call(route+'/research/records/save',{workspaceId:namespace,changes:[{id:recordId,expectedRevision:null,record}]}));
 }
 mark('prepare retained dataset');
 const bytes=Buffer.from('Reading,State\n2,correct\n3,mismatched\n'),upload=await source.startImport({recordId,name:'readings.csv',size:bytes.length});await source.appendImport(upload.id,0,[bytes]);const artifact=await source.finishImport(upload.id),columns=['Reading','State'].map(label=>defaultColumn({label}));columns[0].representation='integer';
 const dataset=await source.dataset({recordId,title:'Retained source readings',artifact,columns}),reference={...dataset,workspaceId:f.a.namespaceId},selected=blankAnalysisSource(reference);Object.assign(selected.columns,{value:0,status:1});
 const command={workspaceId:f.b.namespaceId,recordId,title:'Independent comparison',tool:'Synthetic qualification',version:'1',method:{...blankAnalysisMethod(),unavailable:'Synthetic qualification input.',uncertainty:'Unknown.',limitations:'No scientific inference.'},comparison:{version:2,sources:[selected],ordering:'source',expected:null}};
 const metadataBefore=await f.selected.catalogue(async store=>{const result=[];for await(const id of store.objectIdEntries('metadata:'))result.push(id);return result;});
 mark('discover source owners');
 const ensure=t.mock.method(MaterialIndex.prototype,'ensure',()=>{throw Error('Source discovery must not initialize indexes');});
 const owners=await result(await f.call(prefix+'source-owners',{workspaceId:f.b.namespaceId,projectId:f.projectId,search:'',offset:0,limit:25,revision:null}));assert.ok(owners.items.some(item=>item.workspaceId===f.a.namespaceId));
 const list=await result(await f.call(prefix+'source-items',{workspaceId:f.b.namespaceId,sourceId:f.a.namespaceId,kind:'dataset',query:'',cursor:null,limit:25}));assert.deepEqual(list.items[0].reference,reference);
 const records=await result(await f.call(prefix+'source-items',{workspaceId:f.b.namespaceId,sourceId:f.a.namespaceId,kind:'record',query:'',cursor:null,limit:25}));assert.equal(records.items[0].reference.id,recordId);assert.equal(records.items[0].title,'Source observation');
 const resolved=await result(await f.call(prefix+'source-resolve',{workspaceId:f.b.namespaceId,ref:records.items[0].reference}));assert.equal(resolved.owner.labBookId,f.a.labBookId);
 await f.parent.withLock(()=>f.parent.removeMetadata('.observanda/materials/index/state.json'));
 const empty=await result(await f.call(prefix+'source-items',{workspaceId:f.b.namespaceId,sourceId:f.project.namespaceId,kind:'dataset',query:'',cursor:null,limit:25}));assert.deepEqual(empty.items,[]);assert.equal(await f.parent.readMetadata('.observanda/materials/index/state.json',1024),null);ensure.mock.restore();
 // Neither a source writer nor an unrelated result writer is acquired for discovery.
 mark('read with source writer held');
 let entered,release;const ready=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve),writer=f.selected.withLock(async()=>{entered();await hold;});await ready;
 try{await result(await f.call(prefix+'source-resolve',{workspaceId:f.b.namespaceId,ref:reference}));}finally{release();await writer;}
 mark('first comparison');
 const admitted=await result(await f.call(prefix+'comparison',command),202),first=await completed(f.call,prefix,admitted.job.id);assert.equal(first.state,'completed',JSON.stringify(first));
 const retained=await output.read(first.result);assert.equal(retained.content.comparison.version,2);assert.equal(retained.content.summary.rows,2);
 assert.deepEqual((await result(await f.call(prefix+'analysis-status',{ref:first.result}))).items,[]);
 const overview=await result(await f.call(prefix+'overview',{recordId}));assert.equal(overview.items.find(item=>item.id===first.result.id).dependencyStatus,'checked');
 const page=await result(await f.call(prefix+'comparison-page',{ref:first.result,view:'all'}));assert.equal(page.items.length,2);
 // The actual publication factory resolves private dependencies through the
 // same registry and initiating client, independent of publication selection.
 mark('publication dependencies');
 const publicationApp=new ProjectApplication(f.workspace,{deviceStore:f.device}),publicationClient={},dependencySources=[{recordId,analysis:first.result}],factory=client=>publicationSourceFactory(publicationApp,client,f.sibling,{scope:f.projectId,labBookId:f.b.labBookId});
 try{
  const sourceReader=factory(publicationClient);assert.deepEqual((await publicationDependencyState(output,dependencySources,{sourceReader})).items,[]);
  const live=await createComparisonSourceAccess(publicationApp,publicationClient,{workspace:f.sibling});
  try{
   assert.equal(await live.use(reference,async(storage,canonical)=>(await new ResearchMaterials(storage).read(canonical)).title),'Retained source readings');
   mark('alias amendment');const before=await f.registry.read(),aliases=await new ProjectReferenceAliases(f.workspace).prepare(before.value.aliases??null,{version:1,sourceNamespace:randomUUID(),namespaceId:f.project.namespaceId,projectId:f.projectId},[{kind:'dataset',id:reference.id}]);
   mark('publish aliases');await f.registry.change(before.revision,value=>({...value,aliases}));
   mark('verify aliases');await live.verify();mark('read after aliases');assert.equal(await live.use(reference,async(storage,canonical)=>(await new ResearchMaterials(storage).read(canonical)).title),'Retained source readings');
  }finally{await live.close();}
  await publicationApp.run(publicationClient,projectRequest(f.own+'/access/lock','POST'),{});
  await assert.rejects(publicationDependencyState(output,dependencySources,{sourceReader}),{code:'ACCESS_LOCKED'});
  assert.deepEqual((await publicationDependencyState(output,dependencySources,{sourceReader:factory({})})).items,[]);
  await assert.rejects(publicationDependencyState(output,dependencySources,{sourceReader}),{code:'ACCESS_LOCKED'});
 }finally{await publicationApp.close();}

 // Pause the next worker after HTTP admission, revoke its source, and authorize
 // a different client. That second client's grant cannot revive this attempt.
 mark('revocation worker');
 let running,continueWork;const started=new Promise(resolve=>running=resolve),waiting=new Promise(resolve=>continueWork=resolve),prepare=AnalysisComparisons.prototype.prepare;
 t.mock.method(AnalysisComparisons.prototype,'prepare',async function(input,options){if(input.title==='Revoked comparison'){running();await waitFor(waiting,options.signal);}return prepare.call(this,input,options);});
 const pending=await result(await f.call(prefix+'comparison',{...command,title:'Revoked comparison'}),202);await waitFor(started,t.signal);mark('revoke paused worker');
 const otherClient=await f.client();await result(await f.call(f.own+'/access/lock',{}));await result(await otherClient(f.own+'/access/unlock',{}));continueWork();
 mark('verify revoked worker');
 const failed=await completed(f.call,prefix,pending.job.id);assert.equal(failed.state,'failed');assert.equal(failed.error,'ACCESS_LOCKED');assert.ok(failed.sources.some(ref=>ref.workspaceId===f.a.namespaceId));
 await result(await f.call(prefix+'retry-job',{id:pending.job.id}),401);
 mark('retry revoked worker');await result(await f.call(f.own+'/access/unlock',{}));await result(await f.call(prefix+'retry-job',{id:pending.job.id}));const retried=await completed(f.call,prefix,pending.job.id);assert.equal(retried.id,pending.job.id);assert.equal(retried.state,'completed',JSON.stringify(retried));
 await result(await f.call(f.own+'/access/lock',{}));await result(await f.call(prefix+'analysis-status',{ref:first.result}),401);assert.equal((await result(await f.call(prefix+'comparison-page',{ref:first.result,view:'all'}))).items.length,2);
 const lockedOverview=await result(await f.call(prefix+'overview',{recordId})),lockedItem=lockedOverview.items.find(item=>item.id===first.result.id);assert.equal(lockedItem.dependencyStatus,'unavailable');assert.equal(lockedItem.changedCount,null);assert.equal(lockedItem.dependencyError.labBookId,f.a.labBookId);
 // Persist a checkpoint, close the process while that attempt is preparing,
 // and restart with no in-memory source capability. Only explicit Retry may
 // bind the new caller to the original immutable command.
 await result(await f.call(f.own+'/access/unlock',{}));
 mark('interrupted worker');
 let checkpointReady;const checkpoint=new Promise(resolve=>checkpointReady=resolve);
 t.mock.method(AnalysisComparisons.prototype,'prepare',function(input,options){
  if(input.title!=='Interrupted comparison')return prepare.call(this,input,options);
  return prepare.call(this,input,{...options,writePage:async fn=>{const value=await options.writePage(fn);checkpointReady();await new Promise((resolve,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});return value;}});
 });
 const interrupted=await result(await f.call(prefix+'comparison',{...command,title:'Interrupted comparison'}),202);await waitFor(checkpoint,t.signal);mark('checkpoint retained');
 const work=await f.sibling.readMetadata('.observanda/materials/comparison-work/'+interrupted.job.id+'.json',1024*1024);assert.ok(work);
 mark('restart server');await f.restart();t.mock.method(AnalysisComparisons.prototype,'prepare',prepare);
 const resumedClient=await f.client();assert.ok((await result(await resumedClient(prefix+'overview',{recordId}))).items.some(item=>item.id===first.result.id));const unbound=await completed(resumedClient,prefix,interrupted.job.id);assert.equal(unbound.state,'failed');assert.equal(unbound.error,'ANALYSIS_SOURCE_ACCESS');
 assert.equal(await f.sibling.readMetadata('.observanda/materials/comparison-work/'+interrupted.job.id+'.json',1024*1024),work);
 mark('retry interrupted worker');await result(await resumedClient(prefix+'retry-job',{id:interrupted.job.id}));const resumed=await completed(resumedClient,prefix,interrupted.job.id);assert.equal(resumed.id,interrupted.job.id);assert.equal(resumed.state,'completed',JSON.stringify(resumed));assert.deepEqual(resumed.sources,unbound.sources);
 assert.equal(await f.sibling.readMetadata('.observanda/materials/comparison-work/'+interrupted.job.id+'.json',1024*1024),null);
 mark('verify unchanged source');
 const metadataAfter=await f.selected.catalogue(async store=>{const result=[];for await(const id of store.objectIdEntries('metadata:'))result.push(id);return result;});assert.deepEqual(metadataAfter,metadataBefore);
 assert.equal((await result(await resumedClient('/api/activity'))).operations.some(item=>item.kind.includes('/materials/source-')),false);
});
