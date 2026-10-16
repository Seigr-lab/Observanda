import {ProjectRenames} from '../src/project-rename.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,copyFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {Workspace,workspaceFile} from '../src/storage.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {catalogueBinding,CATALOGUE_FILE} from '../src/postgres-activation.js';
import {openCatalogue,backupCatalogue} from '../src/postgres.js';
import {withScratch} from '../src/scratch-work.js';

async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-project-storage-')),vaults=[];
 const owner=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 t.after(async()=>{await owner.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(path.resolve(parent)),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-project-storage-'));await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 async function create(name){
  const book=sampleNotebook(),id=book.projects[0].id,device=new TestDeviceStore({file:path.join(parent,name+'.device')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
  book.title=name;book.projects[0].title=name;const storage=await initializeProjectLocation(path.join(parent,name),id,book,access,vault);return {storage,id,vault,book};
 }
 return {parent,owner,create,vaults};
}

test('project storage routes actual records, independent writes, history and reopen to its own catalogue',async t=>{
 const f=await fixture(t),a=await f.create('a'),b=await f.create('b'),ordinary=await encryptedFixture(path.join(f.parent,'ordinary'),sampleNotebook());f.vaults.push(ordinary.vault);
 const before=await a.storage.read(),other=await b.storage.read(),binding=await catalogueBinding(a.storage.root);
 assert.equal(binding.placement,'project');assert.equal(binding.version,3);assert.equal(binding.projectId,a.id);assert.equal((await catalogueBinding(ordinary.workspace.root)).placement,'workspace');
 let entered,release;const started=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 const pending=a.storage.withLock(async()=>{entered();await hold;await a.storage.catalogue(store=>store.putObject('metadata:.observanda/test.json',{text:'A committed'}));});
 await started;
 try{
  const record={...other.book.entries[0],title:'B committed while A is busy'};
  await new ResearchRecords(b.storage).save({workspaceId:other.book.id,changes:[{id:record.id,record,expectedRevision:recordRevision(other.book.entries[0])}]},{recordIds:[record.id]});
  await ordinary.workspace.update(book=>{book.title='Workspace independently saved';return book;});
  assert.deepEqual(await a.storage.read(),before);
 }finally{release();await pending;}
 assert.equal((await b.storage.read()).book.entries[0].title,'B committed while A is busy');assert.deepEqual(await b.storage.readRevision(other.etag),other.book);
 assert.equal((await ordinary.workspace.read()).book.title,'Workspace independently saved');
 await a.storage.catalogue(()=>withScratch(async work=>{assert.equal(await work.add('probe',{value:37}),true);assert.equal(work.size,1);}));
 const record={...before.book.entries[0],title:'A retained revision'};await new ResearchRecords(a.storage).save({workspaceId:before.book.id,changes:[{id:record.id,record,expectedRevision:recordRevision(before.book.entries[0])}]});
 const saved=await a.storage.read();assert.deepEqual(await a.storage.readRevision(before.etag),before.book);
 await f.owner.closeProject(a.storage.root);const moved=path.join(f.parent,'moved',path.basename(a.storage.root));await mkdir(path.dirname(moved));await rename(a.storage.root,moved);
 const reopened=new ProjectStorage(moved,a.id,a.vault);assert.deepEqual(await reopened.read(),saved);assert.deepEqual(await reopened.readRevision(before.etag),before.book);
 assert.equal((await b.storage.read()).book.entries[0].title,'B committed while A is busy');
});

test('wrong owner routes and foreign project metadata fail without changing existing bindings or records',async t=>{
 const f=await fixture(t),a=await f.create('selected'),ordinary=await encryptedFixture(path.join(f.parent,'ordinary'),sampleNotebook());f.vaults.push(ordinary.vault);
 const before=await a.storage.read(),file=path.join(a.storage.root,CATALOGUE_FILE),binding=await readFile(file);
 await assert.rejects(new Workspace(a.storage.root,a.vault).read(),{code:'DATABASE_LOCATION'});
 await assert.rejects(new ProjectStorage(a.storage.root,randomUUID(),a.vault).read(),{code:'DATABASE_LOCATION'});
 await assert.rejects(new ProjectStorage(ordinary.workspace.root,a.id,ordinary.vault).read(),{code:'DATABASE_LOCATION'});
 const env=await f.owner.environment(ordinary.workspace.root,{vault:ordinary.vault});
 await assert.rejects(openCatalogue(a.storage.root,{projectId:a.id,vault:a.vault,env}),{code:'DATABASE_LOCATION'});
 await assert.rejects(a.storage.update(book=>{book.projects.push({...book.projects[0],id:randomUUID()});return book;}),{code:'INVALID'});
 await a.storage.withLock(async()=>{
  await assert.rejects(new Workspace(a.storage.root,a.vault).catalogue(store=>store.head()),{code:'DATABASE_LOCATION'});
  await assert.rejects(new ProjectStorage(a.storage.root,randomUUID(),a.vault).readMetadata('.observanda/test.json',4096),{code:'DATABASE_LOCATION'});
 });
 await a.storage.catalogue(async()=>{
  await assert.rejects(new Workspace(a.storage.root,a.vault).catalogue(store=>store.head()),{code:'DATABASE_LOCATION'});
  await assert.rejects(new ProjectStorage(a.storage.root,a.id,{id:a.vault.id,key:Buffer.alloc(32,1)}).catalogue(store=>store.head()),{code:'ACCESS_DENIED'});
 });
 assert.deepEqual(await readFile(file),binding);assert.deepEqual(await a.storage.read(),before);
});

test('a selected project archive restores and accepts edits independently of its original catalogue',async t=>{
 const f=await fixture(t),a=await f.create('source'),before=await a.storage.read(),destination=path.join(f.parent,'archive-copy',path.basename(a.storage.root));await mkdir(path.join(destination,'.observanda'),{recursive:true});
 for(const file of [path.basename(await workspaceFile(a.storage.root)),'.observanda/access.json'])await copyFile(path.join(a.storage.root,file),path.join(destination,file));
 const db=await a.storage.openCatalogue();try{await backupCatalogue(a.storage.root,destination,{connection:db});}finally{await db.close();}
 await f.owner.closeProject(a.storage.root);
 const copy=new ProjectStorage(destination,a.id,a.vault);assert.deepEqual(await copy.read(),before);const originalBinding=await catalogueBinding(a.storage.root),copyBinding=await catalogueBinding(copy.root);assert.notEqual(copyBinding.id,originalBinding.id);assert.equal(copyBinding.placement,'project');
 await copy.update(book=>{book.entries[0].title='Changed in independent copy';return book;});assert.deepEqual(await a.storage.read(),before);
});


test('project imports, evidence, laboratory and verification preserve the selected storage owner',async t=>{
 const f=await fixture(t),a=await f.create('assets'),b=await f.create('other');
 const {MediaImports}=await import('../src/media-imports.js'),{MediaStore}=await import('../src/media.js'),{MediaPolicy}=await import('../src/media-policy.js'),{Laboratory}=await import('../src/laboratory.js'),{workspaceJobs}=await import('../src/workspace-jobs.js'),{contentBuffer}=await import('../src/file-content.js'),{setTimeout:delay}=await import('node:timers/promises');
 const imports=new MediaImports(a.storage),media=new MediaStore(a.storage),policy=new MediaPolicy(a.storage),lab=new Laboratory(a.storage);
 assert.equal(imports.media.workspace,a.storage);assert.equal(media.workspace,a.storage);assert.equal(policy.workspace,a.storage);assert.equal(lab.workspace,a.storage);
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><!-- retained original --><circle cx="16" cy="16" r="12" fill="teal"/></svg>');
 const upload=await imports.start({name:'original-study.svg',size:svg.length,kind:'image'});await imports.receive(upload.id,[svg]);
 const {queue,worker}=workspaceJobs(a.storage);
 await queue.enqueue({id:upload.id,type:'media.prepare',scope:upload.workspaceId,input:{importId:upload.id,size:upload.size}});
 try{
  worker.start();let job;
  for(let n=0;n<400;n++){job=await queue.read(upload.id);if(['failed','completed','cancelled'].includes(job.state))break;await delay(25);}
  assert.equal(job.state,'completed',JSON.stringify(job.error));
 }finally{await worker.stop();}
 const original=await imports.original(upload.id);assert.deepEqual(await contentBuffer(original.content),svg);assert.ok(!(await readFile(original.content.file)).includes(svg));
 assert.equal((await media.get(upload.id)).mime,'image/png');
 const before=await a.storage.read(),entry={...before.book.entries[0],attachments:[{id:upload.id,kind:'image',caption:'Study',alt:'Teal circle',share:true,transcript:''}]};
 await new ResearchRecords(a.storage,media).save({workspaceId:before.book.id,changes:[{id:entry.id,record:entry,expectedRevision:recordRevision(before.book.entries[0])}]});
 const baseline=await lab.read();await lab.change({action:'create-sample',etag:baseline.etag,sample:{code:'A-1',material:'Project specimen',source:'Owned by A',collectedOn:'2026-10-11',receivedOn:'2026-10-11'}});
 assert.equal((await lab.read()).lab.samples.length,1);assert.equal((await new Laboratory(b.storage).read()).lab.samples.length,0);
 await a.storage.catalogue(async store=>store.verify(JSON.parse(await a.storage.readFile(await workspaceFile(a.storage.root),'utf8'))));
 const saved=await a.storage.read();await f.owner.closeProject(a.storage.root);const moved=path.join(f.parent,'moved-assets');await rename(a.storage.root,moved);
 const reopened=new ProjectStorage(moved,a.id,a.vault);assert.deepEqual(await reopened.read(),saved);assert.deepEqual(await contentBuffer((await new MediaImports(reopened).original(upload.id)).content),svg);assert.equal((await new MediaStore(reopened).get(upload.id)).mime,'image/png');assert.equal((await new Laboratory(reopened).read()).lab.samples[0].code,'A-1');
 assert.equal((await new MediaImports(b.storage).list()).length,0);
});


test('fresh project access keys preserve original record identities and history through rekey',async t=>{
 const f=await fixture(t),a=await f.create('rekey-source'),before=await a.storage.read();
 await a.storage.update(book=>{book.entries[0].title='Retained after rekey';return book;});const saved=await a.storage.read();
 const device=new TestDeviceStore({file:path.join(f.parent,'fresh.device')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);f.vaults.push(vault);
 const target=new ProjectStorage(path.join(f.parent,'fresh-project',path.basename(a.storage.root)),a.id,vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});
 const descriptor=await a.storage.readFile(await workspaceFile(a.storage.root),'utf8');
 const {atomicWrite,serialize}=await import('../src/storage.js'),{rekeyCatalogue,verifyCatalogueArchive}=await import('../src/research-catalogue.js');
 await atomicWrite(path.join(target.root,'.observanda','access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),descriptor);
 await rekeyCatalogue(a.storage,target,JSON.parse(descriptor));await verifyCatalogueArchive(target,JSON.parse(descriptor));
 assert.deepEqual(await target.read(),saved);assert.deepEqual(await target.readRevision(before.etag),before.book);assert.deepEqual(await a.storage.read(),saved);
 assert.equal((await catalogueBinding(target.root)).projectId,a.id);
 await assert.rejects(new ProjectStorage(target.root,a.id,a.vault).read());
});


test('project registry and references retain identity across relocation without opening sibling owners',async t=>{
 const f=await fixture(t),a=await f.create('linked-a'),b=await f.create('linked-b'),w=await encryptedFixture(path.join(f.parent,'registry-workspace'),sampleNotebook());f.vaults.push(w.vault);
 const {ProjectRegistry}=await import('../src/project-registry.js'),{ProjectRouter}=await import('../src/project-router.js'),{ProjectReferences}=await import('../src/project-references.js'),{projectReference,parseProjectReference}=await import('../src/web/project-reference.js');
 await f.owner.closeProject(a.storage.root);await f.owner.closeProject(b.storage.root);const aRoot=path.join(w.workspace.root,path.basename(a.storage.root)),bRoot=path.join(aRoot,path.basename(b.storage.root));await rename(a.storage.root,aRoot);await rename(b.storage.root,bRoot);a.storage=new ProjectStorage(aRoot,a.id,a.vault);b.storage=new ProjectStorage(bRoot,b.id,b.vault);
 const registry=new ProjectRegistry(w.workspace,(await w.workspace.outline()).metadata.id);let state=await registry.read();
 state=await registry.attach(a.storage,{expected:state.revision});state=await registry.attach(b.storage,{expected:state.revision,parentId:a.id});
 const raw=await readFile(registry.file);assert.ok(!raw.includes(Buffer.from(a.storage.root)));assert.ok(!raw.includes(Buffer.from(b.id)));
 const opened=[],vaults=new Map([[a.id,a.vault],[b.id,b.vault]]);let allowed=true,locked=false;
 const router=new ProjectRouter(registry,{authorize:async()=>allowed,unlock:async entry=>{opened.push(entry.projectId);return locked?null:vaults.get(entry.projectId);}}),references=new ProjectReferences(router);
 const old=(await b.storage.read()).book.entries[0],target={projectId:b.id,domain:'research',kind:'record',id:old.id,revision:recordRevision(old)};
 const link=projectReference(target);assert.deepEqual(parseProjectReference(link),target);assert.equal(parseProjectReference(link+'&bad=1'),null);
 await b.storage.update(book=>{book.entries[0].title='B revised';return book;});
 assert.deepEqual((await references.resolve(target)).value,old);assert.deepEqual(opened,[b.id]);
 assert.equal((await references.resolve({...target,revision:undefined}).catch(e=>e)).code,'INVALID');
 allowed=false;const count=opened.length;await assert.rejects(references.resolve(target),{code:'ACCESS_DENIED'});assert.equal(opened.length,count);allowed=true;
 locked=true;await assert.rejects(references.resolve(target),{code:'ACCESS_LOCKED'});locked=false;
 const revision=state.revision;await assert.rejects(registry.reparent(a.id,b.id,{expected:revision}),{code:'STORAGE_PATH'});assert.equal((await registry.read()).revision,revision);
 let entered,release;const enteredPromise=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve),busy=w.workspace.withLock(async()=>{entered();await held;});await enteredPromise;
 try{const placed=await new ProjectRenames(registry,b.id).run(b.storage,{id:randomUUID(),name:path.basename(b.storage.root),expectedName:path.basename(b.storage.root),placement:{parentId:null,expectedParentId:a.id}});b.storage=new ProjectStorage(placed.project.root,b.id,b.vault);state=await registry.read();assert.deepEqual((await references.resolve(target)).value,old);}finally{release();await busy;}
 await f.owner.closeProject(b.storage.root);const moved=path.join(f.parent,'relocated',path.basename(b.storage.root));await mkdir(path.dirname(moved));await rename(b.storage.root,moved);
 await assert.rejects(references.resolve(target));const movedStorage=new ProjectStorage(moved,b.id,b.vault);
 state=await registry.relocate(movedStorage,{from:b.storage.root,expected:state.revision});assert.deepEqual((await references.resolve(target)).value,old);assert.equal(projectReference(target),link);
 assert.ok(opened.every(id=>id===b.id));
 await assert.rejects(registry.attach(movedStorage,{expected:state.revision}),{code:'EXISTS'});
 await assert.rejects(registry.reparent(b.id,a.id,{expected:revision}),{code:'CONFLICT'});
 const current=(await movedStorage.read()).book.entries[0];await new ResearchRecords(movedStorage).remove({workspaceId:(await movedStorage.outline()).metadata.id,recordId:old.id,expectedRevision:recordRevision(current)});
 assert.deepEqual((await references.resolve(target)).value,old);const {revision:pinned,...latest}=target;await assert.rejects(references.resolve(latest),{code:'NOT_FOUND'});
});


test('interrupted project creation resumes its intent and never repeats a committed population',async t=>{
 const f=await fixture(t),book=sampleNotebook(),id=book.projects[0].id,device=new TestDeviceStore({file:path.join(f.parent,'creation.device')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);f.vaults.push(vault);
 const root=path.join(f.parent,'interrupted'),options={populateId:'fixture-v1',populate:async storage=>{await storage.catalogue(store=>store.putObject('creation-test',{value:42}));throw Error('injected transaction interruption');}};
 book.title=book.projects[0].title=path.basename(root);
 await assert.rejects(initializeProjectLocation(root,id,book,access,vault,options),/injected transaction interruption/);
 await assert.rejects(new ProjectStorage(root,id,vault).read(),{code:'STORAGE_INCOMPLETE'});
 await assert.rejects(initializeProjectLocation(root,id,{...book,description:'Different request'},access,vault,options),{code:'CONFLICT'});
 let calls=0;options.populate=async storage=>{calls++;await storage.catalogue(store=>store.putObject('creation-test',{value:42}));};
 const write=ProjectStorage.prototype.writeFile;
 ProjectStorage.prototype.writeFile=async function(file,...args){if(path.basename(file)==='workspace.observanda')throw Error('injected descriptor interruption');return write.call(this,file,...args);};
 try{await assert.rejects(initializeProjectLocation(root,id,book,access,vault,options),/injected descriptor interruption/);}finally{ProjectStorage.prototype.writeFile=write;}
 assert.equal(calls,1);
 const resumed=await initializeProjectLocation(root,id,book,access,vault,options);assert.equal(calls,1);assert.equal(await resumed.catalogue(async store=>(await store.object('creation-test')).value),42);
 const saved=await resumed.read();await resumed.update(value=>{value.entries[0].title='Written after recovery';return value;});
 const repeated=await initializeProjectLocation(root,id,book,access,vault,options);assert.equal(calls,1);assert.equal((await repeated.read()).book.entries[0].title,'Written after recovery');assert.deepEqual(await repeated.readRevision(saved.etag),saved.book);
 await assert.rejects(initializeProjectLocation(root,id,{...book,description:'New request'},access,vault,options),{code:'EXISTS'});
});


test('force-terminated project creation releases its lease and resumes with the same identity',async t=>{
 let child,exited,f,root,id,vault;
 t.after(async()=>{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
  if(f&&root&&vault)await f.owner.environment(root,{projectId:id,vault}).catch(()=>{});
 });
 f=await fixture(t);const book=sampleNotebook();id=book.projects[0].id;
 const device=new TestDeviceStore({file:path.join(f.parent,'crash.device')}),access=await createWorkspaceAccess('','',device);vault=takeCreatedVault(access);f.vaults.push(vault);root=path.join(f.parent,'crashed');
 book.title=book.projects[0].title=path.basename(root);
 const {spawn}=await import('node:child_process');
 const script=`import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {initializeProjectLocation} from './src/project-storage.js';let raw='';for await(const bytes of process.stdin)raw+=bytes;const input=JSON.parse(raw),vault={id:input.vault.id,key:Buffer.from(input.vault.key,'base64')};const owner=new WorkspaceDatabases({directory:input.directory,ownerId:input.ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});installDatabaseProvider(owner);await initializeProjectLocation(input.root,input.id,input.book,input.access,vault,{populateId:'crash-v1',populate:async storage=>{await storage.catalogue(store=>store.putObject('crash-test',{value:37}));process.stdout.write('ready');await new Promise(()=>{});}});`;
 child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Creation checkpoint timeout: '+errors)),45000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Creation exited early: '+errors));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
  child.stdin.end(JSON.stringify({directory:f.owner.directory,ownerId:f.owner.instances.ownerId,root,id,book,access,vault:{id:vault.id,key:vault.key.toString('base64')}}));
 });
 child.kill('SIGKILL');await exited;
 const storage=await initializeProjectLocation(root,id,book,access,vault,{populateId:'crash-v1',populate:owner=>owner.catalogue(store=>store.putObject('crash-test',{value:37}))});
 assert.equal((await storage.read()).book.projects[0].id,id);assert.equal(await storage.catalogue(async store=>(await store.object('crash-test')).value),37);
 await storage.update(value=>{value.entries[0].title='Writable after service termination';return value;});assert.equal((await storage.read()).book.entries[0].title,'Writable after service termination');
});

test('identical concurrent creation and pre-intent interruption acknowledge one project',async t=>{
 const f=await fixture(t),book=sampleNotebook(),id=book.projects[0].id,device=new TestDeviceStore({file:path.join(f.parent,'concurrent.device')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);f.vaults.push(vault);
 const root=path.join(f.parent,'before-intent');await mkdir(path.join(root,'.observanda'),{recursive:true});let populated=0;
 book.title=book.projects[0].title=path.basename(root);
 const options={populateId:'concurrent-v1',populate:async()=>{populated++;}};
 const [a,b]=await Promise.all([initializeProjectLocation(root,id,book,access,vault,options),initializeProjectLocation(root,id,book,access,vault,options)]);
 assert.equal(populated,1);assert.equal((await a.read()).etag,(await b.read()).etag);
 assert.deepEqual(await f.owner.details(a),{placement:'project',projectId:id,path:path.join(root,'.observanda','postgresql')});
 await assert.rejects(f.owner.environment(root,{vault}),{code:'DATABASE_LOCATION'});
 await assert.rejects(f.owner.details(new Workspace(root,vault)),{code:'DATABASE_LOCATION'});
});
