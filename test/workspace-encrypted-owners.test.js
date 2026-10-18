import {readProgressStream} from '../src/web/progress-stream.js';
import {workspaceDestinationFixture} from './workspace-destination-fixture.js';
import {ownedStorageLeaseFile,workspaceOwnerLeaseFile} from '../src/owned-storage-control.js';
import {workspaceEncryptedCopyAccess} from '../src/workspace-encrypted-copy.js';
import {WorkspaceProjectCopy} from '../src/workspace-project-copy.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rename,rm,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace,workspaceFile} from '../src/storage.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {WorkspaceCopyRecovery,WORKSPACE_COPY_RECEIPT} from '../src/workspace-copy-recovery.js';
import {workspaceInventory} from '../src/workspace-inventory.js';
import {recordRevision} from '../src/research.js';
import {inspectLocation,initializeLocation} from '../src/locations.js';
import {startServer} from '../src/server.js';

// The mounted copy request has its own ten-minute deadline. Allow setup,
// interrupted retry and independent reopening outside that request budget.
test('fresh-key HTTP copy resumes exact credentials and includes contained and external nested owners',{timeout:process.env.OBSERVANDA_TEST_SECOND_VOLUME?1200000:420000},async t=>{
 const begun=performance.now(),phase=name=>{if(process.env.OBSERVANDA_TEST_SECOND_VOLUME)process.stdout.write(JSON.stringify({phase:name,elapsedMs:Math.round(performance.now()-begun)})+'\n');};
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-encrypted-owners-'));
 const runtime={directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}};
 let provider=new WorkspaceDatabases(runtime),detach=installDatabaseProvider(provider),server,placement;
 const f=await encryptedFixture(directory,createNotebook('workspace')),keys=[f.vault],password='Independent owner credentials',newPassword='Fresh successor credentials';
 t.after(async()=>{await server?.close();await provider.close();detach();keys.forEach(clearVault);await placement?.cleanup();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-encrypted-owners-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 placement=await workspaceDestinationFixture(directory);
 const registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id),projects=[];
 const makeProject=async(root,parentId=null)=>{
  await mkdir(path.dirname(root),{recursive:true});const book=createNotebook(path.basename(root)),project={id:randomUUID(),title:path.basename(root),description:'',share:false,logoId:null};book.projects=[project];
  const grant=await createWorkspaceAccess('',password,f.deviceStore),key=takeCreatedVault(grant);keys.push(key);
  const storage=await initializeProjectLocation(root,project.id,book,grant,key);await registry.attach(storage,{parentId,expected:(await registry.read()).revision});
  const value={projectId:project.id,root,storage};projects.push(value);return value;
 };
 const contained=await makeProject(path.join(f.workspace.root,'Contained Project')),external=await makeProject(path.join(directory,'External Project')),nested=await makeProject(path.join(external.root,'Nested Project'),external.projectId);
 let api;
 const open=async(root,password='')=>{
  server=await startServer({root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
  const session=await fetch(server.origin+'/api/session',{method:'POST',headers:{Origin:server.origin,'Content-Type':'application/json'},body:JSON.stringify({token:server.launchToken})});assert.equal(session.status,200);const cookie=session.headers.get('set-cookie').split(';')[0];let context;
  const raw=(route,{method='GET',body,headers={},signal=AbortSignal.timeout(300000)}={})=>fetch(server.origin+route,{signal,method,body,headers:{Origin:server.origin,Cookie:cookie,...(context?{'X-Observanda-Workspace':context}:{}),...headers}});
  const failure=(error,started,stage)=>{const detail={name:typeof error?.name==='string'?error.name:'unknown',code:typeof error?.code==='string'||typeof error?.code==='number'?error.code:null,elapsedMs:Math.round(performance.now()-started),stage};t.diagnostic(JSON.stringify({requestFailure:detail}));return new Error('HTTP request failed ('+detail.name+', '+detail.code+', '+stage+')',{cause:error});};
  const result=async(route,data)=>{const started=performance.now();try{const response=await raw(route,data===undefined?{}:{method:'POST',body:JSON.stringify(data),headers:{'Content-Type':'application/json','X-Observanda-Wait':'1'}});return {status:response.status,value:await response.json()};}catch(error){throw failure(error,started,'json-request');}};
  const call=async(route,data)=>{const response=await result(route,data);assert.equal(response.status,200,route+': '+JSON.stringify(response.value));return response.value;};
  const stream=async(route,data)=>{const started=performance.now();let stage='request',reported=0,events=0;try{const response=await raw(route,{method:'POST',body:JSON.stringify(data),headers:{'Content-Type':'application/json','X-Observanda-Wait':'1',Accept:'application/x-ndjson'},signal:AbortSignal.timeout(process.env.OBSERVANDA_TEST_SECOND_VOLUME?600000:300000)});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/x-ndjson/);const result=await readProgressStream(response,progress=>{events++;if(typeof progress.stage==='string'&&/^[a-z0-9-]+$/.test(progress.stage))stage=progress.stage;const elapsedMs=Math.round(performance.now()-started);if(process.env.OBSERVANDA_TEST_SECOND_VOLUME&&elapsedMs-reported>=15000){process.stdout.write(JSON.stringify({requestStage:stage,elapsedMs})+'\n');reported=elapsedMs;}});assert.ok(events>0,'Successful storage resume must report progress');return result;}catch(error){throw failure(error,started,stage);}};
  if(password)await call('/api/access/unlock',{username:'',password});context=(await call('/api/storage')).contextId;
  return {call,result,raw,stream,adopt:value=>{context=value.contextId;},context:()=>context};
 };
 const projectRoute=id=>'/api/projects/'+id,bookRoute=book=>projectRoute(book.projectId)+'/lab-books/'+book.labBookId;
 api=await open(f.workspace.root);
 for(const owner of projects)await api.call(projectRoute(owner.projectId)+'/access/unlock',{username:'',password});
 const books=[];
 for(const owner of [contained,nested]){const book=(await api.call(projectRoute(owner.projectId)+'/lab-books/create',{id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId:owner.projectId,title:'Observation Book'}})).book;books.push({...book,projectId:owner.projectId});}
 for(const book of books)await api.call(bookRoute(book)+'/access/unlock',{username:'',password});
 const records=books.map(book=>({...structuredClone(sampleNotebook().entries[0]),id:randomUUID(),notebookId:book.labBookId,title:'Retained observation',body:'Earlier observation',attachments:[],figures:[],relations:[],sections:[]}));
 for(const [i,book] of books.entries()){
  await api.call(bookRoute(book)+'/research/records/save',{workspaceId:book.namespaceId,changes:[{id:records[i].id,expectedRevision:null,record:records[i]}]});
  records[i]=(await api.call(bookRoute(book)+'/workspace/read/selection',{workspaceId:book.namespaceId,ids:[records[i].id]})).book.entries[0];
  const writing=await api.call(bookRoute(book)+'/research/records/writing/read',{workspaceId:book.namespaceId,recordId:records[i].id,sectionId:null});
  await api.call(bookRoute(book)+'/research/records/writing/save',{workspaceId:book.namespaceId,recordId:records[i].id,sectionId:null,expectedRevision:writing.revision,value:{body:'Current observation'}});
 }
 const original={workspaceId:books[1].namespaceId,kind:'record',id:records[1].id,revision:recordRevision(records[1])};
 assert.equal((await api.call('/api/projects/reference',original)).value.body,'Earlier observation');
 const bytes=Buffer.from('synthetic measurement\n1,2,3\n'),prefix=bookRoute(books[0]);
 const upload=await api.call(prefix+'/research/materials/start',{recordId:records[0].id,name:'measurements.csv',size:bytes.length});
 assert.equal((await api.raw(prefix+'/research/materials/chunk/'+upload.id+'/0',{method:'POST',body:bytes,headers:{'Content-Type':'application/octet-stream'}})).status,200);
 assert.equal((await api.result(prefix+'/research/materials/finish',{id:upload.id})).status,202);
 let job;const deadline=Date.now()+60000;do{job=(await api.call(prefix+'/research/materials/job',{id:upload.id})).job;if(['completed','failed'].includes(job.state))break;await delay(50);}while(Date.now()<deadline);assert.equal(job.state,'completed',JSON.stringify(job));const evidence=job.result;
 phase('source owners ready');
 const sourceBefore=await f.workspace.read(),destination=path.join(placement.root,'Fresh Workspace'),snapshot=WorkspaceCopyRecovery.prototype.snapshot;let interrupted=false;
 const fault=t.mock.method(WorkspaceCopyRecovery.prototype,'snapshot',async function(){await snapshot.call(this);if(this.target.root===destination&&!interrupted){interrupted=true;throw Object.assign(Error('Synthetic checkpoint interruption'),{code:'ENOSPC'});}});
 const plan=await api.call('/api/storage/copy/preview',{path:destination});
 const first=await api.result('/api/storage/encrypt',{id:plan.id,reviewed:true,password:newPassword});assert.notEqual(first.status,200);assert.equal(interrupted,true,JSON.stringify(first));fault.mock.restore();
 await assert.rejects(inspectLocation(destination),{code:'STORAGE_INCOMPLETE'});
 const pending=await new WorkspaceCopyRecovery(f.workspace,destination).read(),retainedAccess=await readAccess(destination);assert.equal(pending.version,3);assert.equal(pending.plan.encrypted,true);assert.notEqual(retainedAccess.value.vaultId,f.vault.id);
 await server.close();server=null;api=await open(f.workspace.root);
 for(const owner of projects)await api.call(projectRoute(owner.projectId)+'/access/unlock',{username:'',password});
 for(const book of books)await api.call(bookRoute(book)+'/access/unlock',{username:'',password});
 const retry=await api.call('/api/storage/copy/preview',{path:destination});assert.equal(retry.resume,true);
 assert.notEqual((await api.result('/api/storage/copy',{id:retry.id,reviewed:true})).status,200);
 const denied=await api.result('/api/storage/encrypt',{id:retry.id,reviewed:true,password:'Wrong successor credentials'});assert.notEqual(denied.status,200);assert.equal(denied.value.code,'ACCESS_DENIED');assert.deepEqual(await readAccess(destination),retainedAccess);
 const done=await api.stream('/api/storage/encrypt',{id:retry.id,reviewed:true,password:newPassword});api.adopt(done);assert.equal(done.root,destination);assert.deepEqual(await readAccess(destination),retainedAccess);phase('encrypted copy complete');
 // Password-only child grants survive switching the workspace context.
 for(const [i,book] of books.entries())assert.equal((await api.call(bookRoute(book)+'/research/records/writing/read',{workspaceId:book.namespaceId,recordId:records[i].id,sectionId:null})).value.body,'Current observation');
 assert.deepEqual(await f.workspace.read(),sourceBefore);
 const targetKey=await verifyAccess(await readAccess(destination),'',newPassword,{deviceStore:f.deviceStore});keys.push(targetKey);const target=new Workspace(destination,targetKey),targetRegistry=new ProjectRegistry(target,registry.workspaceId),locations=(await targetRegistry.read()).value.projects;
 assert.equal(locations.find(p=>p.projectId===contained.projectId).root,path.join(destination,'Contained Project'));assert.equal(locations.find(p=>p.projectId===external.projectId).root,path.join(destination,'External Project'));assert.equal(locations.find(p=>p.projectId===nested.projectId).root,path.join(destination,'External Project','Nested Project'));
 await server.close();server=null;await provider.close();detach();provider=new WorkspaceDatabases(runtime);detach=installDatabaseProvider(provider);
 await rename(f.workspace.root,path.join(directory,'Original unavailable'));await rename(external.root,path.join(directory,'External unavailable'));phase('original owners unavailable');
 api=await open(destination,newPassword);for(const owner of projects)await api.call(projectRoute(owner.projectId)+'/access/unlock',{username:'',password});for(const book of books)await api.call(bookRoute(book)+'/access/unlock',{username:'',password});
 for(const [i,book] of books.entries()){const history=await api.call(bookRoute(book)+'/research/records/history/list',{workspaceId:book.namespaceId,recordId:records[i].id});assert.ok(history.versions.length>=2);}
 assert.equal((await api.call('/api/projects/reference',original)).value.body,'Earlier observation');
 const download=await api.raw('/api/projects/material-reference/original/'+books[0].namespaceId+'/'+evidence.id+'/'+evidence.revision+'?context='+api.context());assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 phase('independent history and evidence verified');
 // The old-key recovery control is excluded from normal successor transfer data.
 let controlSeen=false;await workspaceInventory(destination,randomUUID(),{projectRoots:locations.map(p=>p.root),visit:file=>{if(file.path===WORKSPACE_COPY_RECEIPT)controlSeen=true;}});assert.equal(controlSeen,false);
 const copies=path.join(directory,'Selected Copies');await mkdir(copies);await api.call(bookRoute(books[0])+'/storage/copy',{id:randomUUID(),parent:copies});
 const copyRoot=path.join(copies,'Observation Book'),copyKey=await verifyAccess(await readAccess(copyRoot),'',password,{deviceStore:f.deviceStore});keys.push(copyKey);assert.equal((await new LabBookStorage(copyRoot,books[0].labBookId,copyKey).read()).book.entries[0].body,'Current observation');
 await target.catalogue(async store=>store.verify(JSON.parse(await target.readFile(await workspaceFile(target.root),'utf8'))));phase('successor copy and catalogue verified');
});


test('owner lease classification excludes only known control paths',()=>{
 assert.equal(ownedStorageLeaseFile('.observanda/project-registry.lock'),false);
 const id=randomUUID();
 for(const name of ['.observanda/project-registry.lock',...['lab-book-directory','project-import-addresses','project-imports','project-incoming-owners','project-membership','project-lifecycle','project-copies','project-archives','project-moves','project-deletions'].map(folder=>'.observanda/'+folder+'/'+id+'.lock'),'.observanda/project-creation/owner-'+id+'.lock','.observanda/project-owner-revisions/'+id+'.obsv.lock'])assert.equal(workspaceOwnerLeaseFile(name),true,name);
 for(const name of ['.observanda/media/'+id+'.lock','.observanda/project-registry.observanda','.observanda/project-imports/'+id+'.obsv','.observanda/project-imports/notes.lock','.observanda/project-creation/../'+id+'.lock'])assert.equal(workspaceOwnerLeaseFile(name),false,name);
});

test('legacy plaintext successor keeps exact encrypted credentials across interruption and retry',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-legacy-successor-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let vault;
 try{
  const sourceRoot=path.join(directory,'Original'),source=new Workspace(sourceRoot),book=createNotebook('Original');
  await initializeLocation(sourceRoot,book,{formatVersion:1,username:'',password:null},null);
  await writeFile(path.join(sourceRoot,'.observanda/project-registry.lock'),'');
  const destination=path.join(directory,'Successor');let interrupt=true;
  const bundle=new WorkspaceProjectCopy(source,{checkpoint:async stage=>{if(stage==='workspace-snapshot'&&interrupt){interrupt=false;throw Error('Synthetic interruption');}}}),plan=await bundle.plan(destination);
  const prepared=await workspaceEncryptedCopyAccess(source,plan,{password:'Legacy successor password'});vault=prepared.vault;
  await assert.rejects(bundle.encrypted(plan,prepared.access,vault),/Synthetic interruption/);
  await assert.rejects(inspectLocation(destination),{code:'STORAGE_INCOMPLETE'});
  const retained=await new WorkspaceCopyRecovery(source,destination).read();assert.equal(retained.version,3);
  await assert.rejects(workspaceEncryptedCopyAccess(source,retained.plan,{password:'Incorrect successor password'}),{code:'ACCESS_DENIED'});
  const resumed=await workspaceEncryptedCopyAccess(source,retained.plan,{password:'Legacy successor password'});
  try{assert.equal(resumed.vault.id,vault.id);await bundle.encrypted(retained.plan,resumed.access,resumed.vault);assert.deepEqual((await new Workspace(destination,resumed.vault).read()).book,book);}finally{clearVault(resumed.vault);}
  assert.deepEqual((await source.read()).book,book);
  await assert.rejects(access(path.join(destination,'.observanda/project-registry.lock')),{code:'ENOENT'});
 }finally{await provider.close();detach();clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-legacy-successor-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
