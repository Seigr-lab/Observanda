import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {TestDeviceStore} from './device-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {initializeLocation} from '../src/locations.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookReparents} from '../src/lab-book-reparent.js';
import {ProjectBookOwners} from '../src/project-book-owners.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {resolveResearchReference} from '../src/research-owner-reference.js';
import {renameScope} from '../src/workspace-rename-state.js';
import {catalogueBinding} from '../src/postgres-activation.js';

async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'observanda-book-volume-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[];
 t.after(async()=>{await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-volume-'));await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')});
 async function credentials(){const access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);keys.push(vault);return {access,vault};}
 const model=createNotebook('Research Workspace 1'),key=await credentials(),root=path.join(directory,model.title);await initializeLocation(root,model,key.access,key.vault);const workspace=new Workspace(root,key.vault),registry=new ProjectRegistry(workspace,model.id);
 async function project(title){const metadata=createNotebook(title),id=randomUUID(),key=await credentials();metadata.projects=[{id,title,parentId:null,description:'',share:false,logoId:null}];const storage=await initializeProjectLocation(path.join(root,title),id,metadata,key.access,key.vault);await registry.attach(storage,{expected:(await registry.read()).revision});return storage;}
 const source=await project('Field Project 1'),target=await project('Field Project 2');
 async function book(parent,title){const entry=(await new LabBookCreation(parent,device).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:parent.projectId,title}})).book,vault=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:device});keys.push(vault);return new LabBookStorage(entry.root,entry.labBookId,vault);}
 const storage=await book(source,'\u00c5ngstr\u00f6m Notes 1'),sibling=await book(target,'Independent Notes');
 const record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId};await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:(await storage.outline()).metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
 const before=await storage.read(),reference={workspaceId:before.book.id,kind:'record',id:record.id,revision:recordRevision(before.book.entries[0])};
 const materials=new ResearchMaterials(storage),bytes=Buffer.from('Original observation bytes'),upload=await materials.startImport({recordId:record.id,name:'observations.txt',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 return {directory,provider,registry,source,target,storage,sibling,before,reference,artifact,bytes,device};
}
async function differentFilesystem(storage,destination,operation){
 const rename=fs.rename;let rejected=0;
 fs.rename=async(from,to)=>{if(from===storage.root&&to===destination){rejected++;throw Object.assign(Error('Another filesystem'),{code:'EXDEV'});}return rename(from,to);};syncBuiltinESMExports();
 try{return await operation(()=>rejected);}finally{fs.rename=rename;syncBuiltinESMExports();}
}

test('cross-filesystem book relocation resumes transfer, registration and retirement without changing sibling owners',{timeout:180000},async t=>{
 const f=await fixture(t),{source,target,storage}=f,original=(await storage.read()).book.entries[0],siblingBefore=await f.sibling.read(),siblingBinding=await catalogueBinding(f.sibling.root);
 const command=new LabBookReparents(f.registry,storage.labBookId),id=randomUUID(),sourceRoot=storage.root,destination=path.join(target.root,path.basename(sourceRoot)),sourceBinding=await catalogueBinding(sourceRoot);let transferred=false;
 await differentFilesystem(storage,destination,async count=>{
  // Advance one interrupted move through every durable boundary. A completed
  // transfer must not be repeated merely to recover a later registration step.
  for(const stage of ['copying','copy:file-receipt','copy:database-committed','copy:verified','transferred','metadata','attached','addressed','registered','retiring','retire-frozen','source-retired','retired','retire:removed','retire:marker-removed','source-removed','complete']){
   let injected=false;
   await assert.rejects(new LabBookReparents(f.registry,storage.labBookId).run(source,target,storage.vault,{id,checkpoint:point=>{
    if(transferred&&point.startsWith('copy:'))assert.fail('Verified transfer repeated during recovery');
    if(point===stage&&!injected){injected=true;if(stage==='transferred')transferred=true;throw Error('Interrupted '+stage);}
   }}),new RegExp('Interrupted '+stage));assert.equal(injected,true);assert.equal(count(),1);
   assert.deepEqual(await f.sibling.read(),siblingBefore);assert.deepEqual(await catalogueBinding(f.sibling.root),siblingBinding);
   process.stdout.write('Recovered cross-filesystem '+stage+'\n');
  }
  const result=await command.run(source,target,storage.vault,{id});assert.equal(result.complete,true);assert.equal(result.book.root,destination);assert.equal(count(),1,'resume must not attempt the failed rename again');
 });
 await assert.rejects(fs.stat(sourceRoot),{code:'ENOENT'});const binding=await catalogueBinding(destination);assert.notEqual(binding.id,sourceBinding.id);assert.equal(binding.labBookId,storage.labBookId);
 const moved=new LabBookStorage(destination,storage.labBookId,storage.vault),after=await moved.read();assert.deepEqual(after.book.entries,[original]);assert.equal(after.book.notebooks[0].title,path.basename(destination));assert.equal(after.book.notebooks[0].projectId,target.projectId);
 const address=await f.registry.reference(f.reference);assert.equal(address.projectId,target.projectId);assert.equal((await resolveResearchReference(moved,f.reference,{namespaceId:f.before.book.id})).value.body,original.body);
 const materials=new ResearchMaterials(moved);assert.deepEqual(await moved.readFile(await materials.artifactPath(await materials.read(f.artifact))),f.bytes);
 await new ProjectBookOwners(source).ready();await new ProjectBookOwners(target).ready();assert.equal((await command.run(source,target,storage.vault,{id})).complete,true);
});

test('retirement preserves a replacement source folder and refuses a replaced destination',{timeout:180000},async t=>{
 const f=await fixture(t),{source,target,storage,registry}=f,command=new LabBookReparents(registry,storage.labBookId),id=randomUUID(),destination=path.join(target.root,path.basename(storage.root));
 await differentFilesystem(storage,destination,()=>assert.rejects(command.run(source,target,storage.vault,{id,checkpoint:point=>{if(point==='source-retired')throw Error('Stopped after retirement');}}),/Stopped after retirement/));
 await fs.mkdir(storage.root);const sentinel=path.join(storage.root,'user-created.txt');await fs.writeFile(sentinel,'Keep this new folder');
 await f.provider.closeLabBook(destination);const moved=destination+' saved';await fs.rename(destination,moved);await fs.mkdir(destination);
 await assert.rejects(command.run(source,target,storage.vault,{id}),{code:'STORAGE_RENAME_STATE'});await fs.rmdir(destination);await fs.rename(moved,destination);
 assert.equal((await command.run(source,target,storage.vault,{id})).complete,true);assert.equal(await fs.readFile(sentinel,'utf8'),'Keep this new folder');assert.equal((await new LabBookRegistry(target).locate(storage.labBookId)).root,destination);
});

test('a transferring book does not reserve unrelated book creation or writing',{timeout:180000},async t=>{
 const f=await fixture(t),{source,target,storage,registry}=f,command=new LabBookReparents(registry,storage.labBookId),id=randomUUID(),destination=path.join(target.root,path.basename(storage.root));let exercised=false;
 await differentFilesystem(storage,destination,()=>command.run(source,target,storage.vault,{id,checkpoint:async stage=>{
  if(stage!=='copy:files'||exercised)return;exercised=true;
  const started=Date.now(),created=await new LabBookCreation(target,f.device).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:target.projectId,title:'New Independent Notes'}});assert.ok(Date.now()-started<15000);assert.equal(created.book.directory,'New Independent Notes');
  const record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:f.sibling.labBookId};await new ResearchRecords(f.sibling,new MediaStore(f.sibling)).save({workspaceId:(await f.sibling.outline()).metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
 }}));assert.equal(exercised,true);assert.equal((await new LabBookRegistry(target).read()).value.books.length,3);assert.equal((await f.sibling.read()).book.entries.length,1);
});

test('recovery authenticates retained record payloads before retiring the source database',{timeout:180000},async t=>{
 const f=await fixture(t),{source,target,storage,registry}=f,command=new LabBookReparents(registry,storage.labBookId),id=randomUUID(),destination=path.join(target.root,path.basename(storage.root));
 await differentFilesystem(storage,destination,()=>assert.rejects(command.run(source,target,storage.vault,{id,checkpoint:point=>{if(point==='registered')throw Error('Stopped before retirement');}}),/Stopped before retirement/));
 const copied=new LabBookStorage(destination,storage.labBookId,storage.vault),write=operation=>renameScope(id,()=>copied.withLock(()=>copied.catalogue(operation)));
 const retained=await write(async store=>{const row=await store.db.get('SELECT id,revision,payload FROM records LIMIT 1');assert.ok(row);await store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',Buffer.alloc(row.payload.length),row.id,row.revision);return row;});
 await assert.rejects(command.run(source,target,storage.vault,{id}),error=>['ENCRYPTION_DAMAGED','CATALOGUE_DAMAGED'].includes(error.code));assert.equal((await command.read()).phase,'registered');assert.ok(await fs.stat(storage.root));
 await write(store=>store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',retained.payload,retained.id,retained.revision));
 assert.equal((await command.run(source,target,storage.vault,{id})).complete,true);assert.equal((await copied.read()).book.entries[0].body,f.before.book.entries[0].body);
});
