import {ProjectRenames} from '../src/project-rename.js';
import {initializeLocation} from '../src/locations.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {ProjectDeletions,pendingProjectDeletions} from '../src/project-deletion.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {ProjectOpening} from '../src/project-opening.js';
import {copyProjectLocation} from '../src/project-transfer.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {workspaceDeletion} from '../src/workspace-delete-state.js';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-project-delete-')),keys=[],device=new TestDeviceStore({file:path.join(root,'device')}),owner=new WorkspaceDatabases({directory:path.join(root,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 t.after(async()=>{await owner.close();detach();for(const key of keys)clearVault(key);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-project-delete-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const key=async()=>{const access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);keys.push(vault);return {access,vault};};
 const registryKey=await key(),registryRoot=path.join(root,'registry'),registryBook=sampleNotebook();await initializeLocation(registryRoot,registryBook,registryKey.access,registryKey.vault);const registry=new ProjectRegistry(new Workspace(registryRoot,registryKey.vault),registryBook.id);
 async function project(name,parentId=null,{nested=false}={}){const book=sampleNotebook(),id=book.projects[0].id,{access,vault}=await key();book.title=book.projects[0].title=name;const storage=await initializeProjectLocation(path.join(nested?(parentId?(await registry.locate(parentId)).root:registry.workspace.root):root,name),id,book,access,vault);await registry.attach(storage,{parentId,expected:(await registry.read()).revision});await storage.writeFile(path.join(storage.root,'.observanda/original.bin'),'original '+name);return {storage,vault,id,book};}
 async function book(parent,title){
  const {book}=await new LabBookCreation(parent.storage,device).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:parent.id,title}}),vault=await verifyAccess(await readAccess(book.root),'','',{deviceStore:device});keys.push(vault);
  const storage=new LabBookStorage(book.root,book.labBookId,vault),initial=await storage.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:book.labBookId};
  await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:initial.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});return storage;
 }
 return {root,registry,registryKey,project,book,owner,device};
}
const interrupted=phase=>async stage=>{if(stage===phase)throw Error('Interrupted '+phase);};
test('deleting a portable project preserves independent children and sibling data and retains deleted references',async t=>{
 const f=await fixture(t),a=await f.project('selected'),b=await f.project('sibling'),child=await f.project('child',a.id),sibling=await b.storage.read(),childBook=await child.storage.read(),id=randomUUID(),backup=path.join(f.root,'backup',path.basename(a.storage.root)),original=await a.storage.read();
 await mkdir(path.dirname(backup));await copyProjectLocation(a.storage,backup,{id:randomUUID()});const deletions=new ProjectDeletions(f.registry,a.id),source=a.storage.root;
 assert.equal((await deletions.run(a.vault,{id,expectedRoot:source})).complete,true);await assert.rejects(stat(source),{code:'ENOENT'});
 assert.deepEqual(await b.storage.read(),sibling);assert.deepEqual(await child.storage.read(),childBook);assert.equal((await f.registry.locate(child.id)).parentId,null);
 await assert.rejects(f.registry.locate(a.id),{code:'PROJECT_DELETED'});await assert.rejects(f.registry.namespace(a.book.id),{code:'PROJECT_DELETED'});
 assert.equal((await deletions.run(null,{id})).complete,true);assert.deepEqual((await pendingProjectDeletions(f.registry)).items,[]);
 const opened=await new ProjectOpening(f.registry,f.device).open({id:randomUUID(),path:backup,username:'',password:'',recovery:''});assert.equal(opened.project.projectId,a.id);assert.equal((await f.registry.namespace(a.book.id)).root,backup);
 assert.equal((await deletions.run(null,{id})).complete,true);assert.deepEqual(await new ProjectStorage(backup,a.id,a.vault).read(),original);
});
test('project deletion recovers each durable boundary and never traverses a reused original path',async t=>{
 const f=await fixture(t);
 for(const stage of ['prepared','frozen','database','retired','file','files','removed']){
  const a=await f.project('phase-'+stage),id=randomUUID(),deletions=new ProjectDeletions(f.registry,a.id),source=a.storage.root;
  await assert.rejects(deletions.run(a.vault,{id,expectedRoot:source,checkpoint:interrupted(stage)}),new RegExp('Interrupted '+stage));
  assert.equal((await pendingProjectDeletions(f.registry)).items.some(item=>item.id===id),true);assert.equal((await deletions.status()).running,false);
  if(['retired','file','files','removed'].includes(stage)){await mkdir(source);await writeFile(path.join(source,'new.txt'),'unrelated new folder');}
  const recovered=await new ProjectDeletions(f.registry,a.id).run(a.vault,{id});assert.equal(recovered.complete,true);
  if(['retired','file','files','removed'].includes(stage))assert.equal(await readFile(path.join(source,'new.txt'),'utf8'),'unrelated new folder');else await assert.rejects(stat(source),{code:'ENOENT'});
  await assert.rejects(f.registry.locate(a.id),{code:'PROJECT_DELETED'});
 }
});
test('project deletion rejects stale locations, wrong keys and unfinished transfers before freezing',async t=>{
 const f=await fixture(t),a=await f.project('protected'),b=await f.project('other'),deletions=new ProjectDeletions(f.registry,a.id),id=randomUUID(),before=await a.storage.read();
 await assert.rejects(deletions.run(a.vault,{id,expectedRoot:b.storage.root}),{code:'CONFLICT'});await assert.rejects(deletions.run(b.vault,{id,expectedRoot:a.storage.root}));
 const copy=path.join(f.registry.workspace.root,'.observanda/project-copies',a.id+'.obsv');await mkdir(path.dirname(copy),{recursive:true});await f.registry.workspace.writeFile(copy,JSON.stringify({version:1,projectId:a.id,id:randomUUID(),phase:'copying'}));await assert.rejects(deletions.run(a.vault,{id}),{code:'STORAGE_PROJECT_BUSY'});
 assert.equal(await workspaceDeletion(a.storage.root),null);assert.deepEqual(await a.storage.read(),before);assert.equal((await f.registry.locate(a.id)).root,a.storage.root);
});


test('forced termination recovers project deletion from frozen, stopped, retired and partial-file boundaries',async t=>{
 const f=await fixture(t),{spawn}=await import('node:child_process');
 for(const checkpoint of ['frozen','database','retired','file']){
  const a=await f.project('killed-'+checkpoint),id=randomUUID();await f.owner.closeProject(a.storage.root);await f.owner.closeWorkspace(f.registry.workspace.root);
  const script=`import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {Workspace} from './src/storage.js';import {ProjectRegistry} from './src/project-registry.js';import {ProjectDeletions} from './src/project-deletion.js';let input='';for await(const bytes of process.stdin)input+=bytes;const p=JSON.parse(input),decode=v=>({id:v.id,key:Buffer.from(v.key,'base64')}),owner=new WorkspaceDatabases({directory:p.directory,ownerId:p.ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});installDatabaseProvider(owner);const registry=new ProjectRegistry(new Workspace(p.registry,decode(p.registryVault)),p.workspaceId);await new ProjectDeletions(registry,p.projectId).run(decode(p.vault),{id:p.id,checkpoint:async stage=>{if(stage===p.checkpoint){process.stdout.write('ready');await new Promise(()=>{});}}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']}),exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',data=>errors+=data);
  try{
   const encode=v=>({id:v.id,key:v.key.toString('base64')});
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Deletion checkpoint timeout: '+errors)),60000);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('Exited before checkpoint: '+errors));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.stdin.end(JSON.stringify({directory:f.owner.directory,ownerId:f.owner.instances.ownerId,registry:f.registry.workspace.root,workspaceId:f.registry.workspaceId,registryVault:encode(f.registryKey.vault),projectId:a.id,vault:encode(a.vault),id,checkpoint}));});
   child.kill('SIGKILL');await exited;
   // A restarted application opens its workspace before resuming a project command.
   // Reclaim the workspace service started by the terminated child as well.
   await f.registry.workspace.outline();
   if(['retired','file'].includes(checkpoint)){await mkdir(a.storage.root);await writeFile(path.join(a.storage.root,'replacement.txt'),'preserved replacement');}
   assert.equal((await new ProjectDeletions(f.registry,a.id).run(a.vault,{id})).complete,true);
   if(['retired','file'].includes(checkpoint))assert.equal(await readFile(path.join(a.storage.root,'replacement.txt'),'utf8'),'preserved replacement');else await assert.rejects(stat(a.storage.root),{code:'ENOENT'});
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();await f.registry.workspace.outline();await new ProjectDeletions(f.registry,a.id).run(a.vault,{id}).catch(()=>{});}
 }
});


test('deleting a nested leaf project preserves its containing workspace and parent project',{timeout:120000},async t=>{
 const f=await fixture(t),parent=await f.project('Parent Project',null,{nested:true}),selected=await f.project('Selected Project',parent.id,{nested:true}),sibling=await f.project('Sibling Project',parent.id,{nested:true}),beforeParent=await parent.storage.read(),beforeSibling=await sibling.storage.read(),beforeWorkspace=await f.registry.workspace.read(),deletions=new ProjectDeletions(f.registry,selected.id),id=randomUUID();
 f.registry.read=async()=>{throw Error('Deletion must use selected directory indexes');};
 await assert.rejects(deletions.run(selected.vault,{id,expectedRoot:selected.storage.root,checkpoint:interrupted('frozen')}),/Interrupted frozen/);
 assert.equal((await new ProjectDeletions(f.registry,selected.id).run(selected.vault,{id})).complete,true);await assert.rejects(stat(selected.storage.root),{code:'ENOENT'});
 assert.deepEqual(await parent.storage.read(),beforeParent);assert.deepEqual(await sibling.storage.read(),beforeSibling);assert.deepEqual(await f.registry.workspace.read(),beforeWorkspace);assert.equal((await f.registry.locate(sibling.id)).parentId,parent.id);await assert.rejects(f.registry.locate(selected.id),{code:'PROJECT_DELETED'});
});


test('nested project deletion authorizes each book and recovers before and after child database shutdown',{timeout:240000},async t=>{
 const f=await fixture(t),sibling=await f.project('Preserved Project',null,{nested:true}),siblingBook=await f.book(sibling,'Preserved Book'),before=await siblingBook.read();
 for(const stage of ['book-frozen','book-stopped','retired']){
  const selected=await f.project('Selected '+stage,null,{nested:true}),first=await f.book(selected,'First Book'),second=await f.book(selected,'Second Book'),books=new Map([first,second].map(book=>[book.labBookId,book])),id=randomUUID(),deletions=new ProjectDeletions(f.registry,selected.id);
  await assert.rejects(deletions.run(selected.vault,{id}),{code:'ACCESS_LOCKED'});assert.equal(await workspaceDeletion(selected.storage.root),null);
  const withBook=async(project,id,use)=>{assert.equal(project.projectId,selected.id);return use(books.get(id));};
  await assert.rejects(deletions.run(selected.vault,{id,withBook,checkpoint:interrupted(stage)}),new RegExp('Interrupted '+stage));
  if(stage!=='retired'){
   await assert.rejects(first.read(),{code:'STORAGE_DELETING'});await assert.rejects(second.read(),{code:'STORAGE_DELETING'});
   await assert.rejects(new LabBookCreation(selected.storage,f.device).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:selected.id,title:'Late Book'}}),{code:'STORAGE_DELETING'});
  }
  const receipt=await deletions.receipt();assert.equal(receipt.books.length,2);assert.equal(JSON.stringify(receipt).includes(first.vault.key.toString('base64')),false);
  // Recovery uses only the authorized operation's encrypted child capabilities.
  assert.equal((await new ProjectDeletions(f.registry,selected.id).run(stage==='retired'?null:selected.vault,{id})).complete,true);
  await assert.rejects(stat(selected.storage.root),{code:'ENOENT'});await assert.rejects(stat(path.join(f.registry.workspace.root,'.observanda-delete-'+id)),{code:'ENOENT'});
  assert.deepEqual(await siblingBook.read(),before);assert.equal((await f.registry.locate(sibling.id)).root,sibling.storage.root);
 }
});


test('parent deletion preserves nested subprojects and their books across interrupted native placement',{timeout:240000},async t=>{
 const f=await fixture(t),parent=await f.project('Selected Parent',null,{nested:true}),child=await f.project('Independent Child',parent.id,{nested:true}),other=await f.project('Other Child',parent.id,{nested:true}),grandchild=await f.project('Grandchild',child.id,{nested:true}),ownedBook=await f.book(parent,'Owned Book'),childBook=await f.book(child,'Child Book'),grandchildBook=await f.book(grandchild,'Grandchild Book'),beforeChild=await childBook.read(),beforeGrandchild=await grandchildBook.read(),projects=new Map([parent,child,other,grandchild].map(item=>[item.id,item])),books=new Map([ownedBook,childBook,grandchildBook].map(book=>[book.labBookId,book])),id=randomUUID();
 const withProject=async(projectId,use)=>{const renames=new ProjectRenames(f.registry,projectId),pending=await renames.read();if(pending&&!['complete','cancelled'].includes(pending.phase))await renames.resume(projects.get(projectId).vault);const entry=await f.registry.locate(projectId);return use(new ProjectStorage(entry.root,projectId,projects.get(projectId).vault));};
 const withBook=async(project,bookId,use)=>{const known=books.get(bookId),root=path.join(project.root,path.basename(known.root));return use(new LabBookStorage(root,bookId,known.vault));};
 f.registry.read=async()=>{throw Error('Deletion must use selected directory indexes');};
 const deletions=new ProjectDeletions(f.registry,parent.id),callbacks={id,withProject,withBook};
 // Collision admission precedes any move, even if a different child is clear.
 const collision=path.join(f.registry.workspace.root,path.basename(other.storage.root));await mkdir(collision);await writeFile(path.join(collision,'unrelated.txt'),'unrelated');
 await assert.rejects(deletions.run(parent.vault,callbacks),{code:'EXISTS'});assert.equal(await deletions.receipt(),null);assert.ok(await stat(child.storage.root));
 assert.equal(await readFile(path.join(collision,'unrelated.txt'),'utf8'),'unrelated');assert.equal(path.dirname(collision),f.registry.workspace.root);await rm(collision,{recursive:true});
 await assert.rejects(deletions.run(parent.vault,{...callbacks,checkpoint:interrupted('preserve-renamed')}),/Interrupted preserve-renamed/);
 assert.equal((await deletions.receipt()).phase,'preserving');assert.ok(await stat(parent.storage.root));
 assert.equal((await new ProjectDeletions(f.registry,parent.id).run(parent.vault,callbacks)).complete,true);await assert.rejects(stat(parent.storage.root),{code:'ENOENT'});
 const movedChild=await f.registry.locate(child.id),movedOther=await f.registry.locate(other.id),movedGrandchild=await f.registry.locate(grandchild.id);
 assert.equal(movedChild.root,path.join(f.registry.workspace.root,'Independent Child'));assert.equal(movedChild.parentId,null);assert.equal(movedOther.parentId,null);assert.equal(movedGrandchild.parentId,child.id);assert.equal(movedGrandchild.root,path.join(movedChild.root,'Grandchild'));
 assert.deepEqual(await new LabBookStorage(path.join(movedChild.root,'Child Book'),childBook.labBookId,childBook.vault).read(),beforeChild);assert.deepEqual(await new LabBookStorage(path.join(movedGrandchild.root,'Grandchild Book'),grandchildBook.labBookId,grandchildBook.vault).read(),beforeGrandchild);
 await assert.rejects(f.registry.locate(parent.id),{code:'PROJECT_DELETED'});
});
