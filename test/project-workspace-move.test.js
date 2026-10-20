import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture,destinationProject} from './project-tree-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {ProjectWorkspaceMoves} from '../src/project-workspace-move.js';
import {withProjectLifecycle} from '../src/project-lifecycle.js';
import {assertProjectRelocationsSettled} from '../src/project-membership.js';
import {incomingProjectMove} from '../src/project-incoming-moves.js';
import {workspaceRename,renameScope} from '../src/workspace-rename-state.js';
import {catalogueBinding} from '../src/postgres-activation.js';

async function fixture(t,{destinationParent}={}){
 const f=await projectTreeFixture(t);let receivingParent=f.directory;
 if(destinationParent){
  const parent=path.resolve(await fs.realpath(destinationParent));receivingParent=await fs.mkdtemp(path.join(parent,'observanda-project-volume-'));
  t.after(async()=>{assert.equal(path.dirname(receivingParent),parent);assert.ok(path.basename(receivingParent).startsWith('observanda-project-volume-'));await fs.rm(receivingParent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 }
 const metadata=createNotebook('Receiving Workspace 2'),target=await encryptedFixture(path.join(receivingParent,metadata.title),metadata,undefined,destinationParent?{deviceDirectory:path.join(f.directory,'receiving-device')}:undefined);t.after(()=>clearVault(target.vault));
 const targetRegistry=new ProjectRegistry(target.workspace,metadata.id),selected=f.projects[0],source=new ProjectStorage(selected.root,selected.projectId,selected.key),moves=new ProjectWorkspaceMoves(f.registry,targetRegistry,selected.projectId),sibling=await destinationProject(f,t);
 const callbacks={withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,f.projects.find(project=>project.projectId===id).key)),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key))};
 return {...f,targetRegistry,source,moves,sibling,options:{id:randomUUID(),parentId:null,expectedParentId:null,...callbacks},destination:path.join(target.workspace.root,path.basename(source.root))};
}
async function tree(f,copied){
 await assert.rejects(fs.stat(f.source.root),{code:'ENOENT'});
 for(const saved of f.projects){
  await assert.rejects(f.registry.locate(saved.projectId),error=>error.code==='PROJECT_MOVED'&&error.workspaceId===f.targetRegistry.workspaceId);
  const entry=await f.targetRegistry.locate(saved.projectId),root=path.join(f.destination,path.relative(f.source.root,saved.root));assert.equal(entry.root,root);assert.equal(entry.parentId,saved.parentId);assert.equal(await incomingProjectMove(f.targetRegistry,saved.projectId),null);assert.equal(await workspaceRename(root),null);
  const binding=await catalogueBinding(root);assert.equal(binding.projectId,saved.projectId);if(copied)assert.notEqual(binding.id,saved.binding.id);else assert.equal(binding.id,saved.binding.id);
  for(const book of f.books.filter(item=>item.projectId===saved.projectId)){
   assert.equal((await new LabBookDirectory(f.targetRegistry).locate(book.namespaceId)).projectId,saved.projectId);
   const bookRoot=path.join(root,path.basename(book.root));assert.deepEqual(await new LabBookStorage(bookRoot,book.labBookId,book.key).read(),book.before);assert.equal(await workspaceRename(bookRoot),null);
  }
 }
 assert.equal((await f.registry.read()).value.projects.length,1);assert.equal((await f.targetRegistry.read()).value.projects.length,2);
}
for(const copied of [false,true])test((copied?'cross-filesystem':'native')+' workspace handoff recovers publication and departure without losing independent owners',{timeout:600000},async t=>{
 const f=await fixture(t),originalRename=fs.rename;let attempts=0,transferred=false;
 if(copied){fs.rename=async(from,to)=>{if(from===f.source.root&&to===f.destination){attempts++;throw Object.assign(Error('Different filesystem'),{code:'EXDEV'});}return originalRename(from,to);};syncBuiltinESMExports();}
 try{
  const stages=['prepared','frozen','project-frozen','project-stopped','stopped',...(copied?['copying','copy:file-receipt','copy:database-committed','owner-copied','transferred']:['folder-moved']),'destination-registry','destination-addresses','registered',...(copied?['retiring','source-retired','retired','retire:removed','source-removed']:[]),'departing','source-directory','departed','unfrozen','complete','released'];
  for(const boundary of stages){
   let hit=false;
   await assert.rejects(f.moves.run(f.source,{...f.options,checkpoint:async stage=>{
    if(transferred&&stage.startsWith('copy:'))assert.fail('Completed transfer repeated');
    if(stage===boundary&&!hit){hit=true;if(stage==='transferred')transferred=true;throw Error('Interrupted '+boundary);}
   }}),new RegExp('Interrupted '+boundary));assert.ok(hit,boundary);
   if(!['complete','released'].includes(boundary)){
    await assert.rejects(assertProjectRelocationsSettled(f.targetRegistry,[null]),{code:'STORAGE_PROJECT_BUSY'});
    await assertProjectRelocationsSettled(f.registry,[f.sibling.projectId]);
   }
   if(['destination-registry','registered'].includes(boundary))await assert.rejects(withProjectLifecycle(f.targetRegistry,f.source.projectId,'delete',()=>assert.fail('Incoming project admitted')),{code:'STORAGE_PROJECT_BUSY'});
   await new ProjectStorage(f.sibling.root,f.sibling.projectId,f.sibling.key).update(value=>{value.projects[0].description='Saved while '+boundary;return value;});
   process.stdout.write('Workspace handoff '+boundary+'\n');
  }
  const result=await f.moves.resume(f.source.vault,f.options);assert.equal(result.complete,true);assert.equal(result.workspaceId,f.targetRegistry.workspaceId);if(copied)assert.equal(attempts,1);
 }finally{fs.rename=originalRename;syncBuiltinESMExports();}
 await tree(f,copied);
 // Restart all database owners and reopen the authoritative destination.
 await f.stopProvider();f.restartProvider();await tree(f,copied);
});

test('workspace handoff rejects changed retained records before retirement and accepts an independently authorized return',{timeout:360000},async t=>{
 const f=await fixture(t),originalRename=fs.rename;fs.rename=async(from,to)=>{if(from===f.source.root&&to===f.destination)throw Object.assign(Error('Different filesystem'),{code:'EXDEV'});return originalRename(from,to);};syncBuiltinESMExports();
 try{await assert.rejects(f.moves.run(f.source,{...f.options,checkpoint:stage=>{if(stage==='registered')throw Error('Retirement not started');}}),/Retirement not started/);}finally{fs.rename=originalRename;syncBuiltinESMExports();}
 const book=f.books[1],root=path.join(f.destination,path.relative(f.source.root,book.root)),storage=new LabBookStorage(root,book.labBookId,book.key),write=operation=>renameScope(f.options.id,()=>storage.withLock(()=>storage.catalogue(operation)));
 const row=await write(async store=>{const row=await store.db.get('SELECT id,revision,payload FROM records LIMIT 1');await store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',Buffer.alloc(row.payload.length),row.id,row.revision);return row;});
 await assert.rejects(f.moves.resume(f.source.vault),error=>['ENCRYPTION_DAMAGED','CATALOGUE_DAMAGED'].includes(error.code));assert.equal((await f.moves.read()).phase,'registered');for(const project of f.projects)assert.ok(await fs.stat(project.root));
 await write(store=>store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',row.payload,row.id,row.revision));await f.moves.resume(f.source.vault);await tree(f,true);
 const returning=new ProjectWorkspaceMoves(f.targetRegistry,f.registry,f.source.projectId),callbacks={withProject:async(id,use)=>use(new ProjectStorage((await f.targetRegistry.locate(id)).root,id,f.projects.find(project=>project.projectId===id).key)),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key))};
 const result=await returning.run(new ProjectStorage(f.destination,f.source.projectId,f.source.vault),{id:randomUUID(),parentId:null,expectedParentId:null,...callbacks});assert.equal(result.project.root,f.source.root);assert.deepEqual((await f.registry.read()).value.relocated,[]);assert.equal((await f.registry.read()).value.projects.length,3);await assert.rejects(f.targetRegistry.locate(f.source.projectId),{code:'PROJECT_MOVED'});
 for(const saved of f.books)assert.deepEqual(await new LabBookStorage(saved.root,saved.labBookId,saved.key).read(),saved.before);
});

test('killed cross-workspace transfer recovers retirement without deleting a replacement source folder',{timeout:360000},async t=>{
 const f=await fixture(t);await f.stopProvider();const {spawn}=await import('node:child_process');let child,ended;
 const script=`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {Workspace} from './src/storage.js';import {ProjectRegistry} from './src/project-registry.js';import {ProjectStorage} from './src/project-storage.js';import {LabBookStorage} from './src/lab-book-storage.js';import {LabBookRegistry} from './src/lab-book-registry.js';import {ProjectWorkspaceMoves} from './src/project-workspace-move.js';let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw),key=value=>({id:value.id,key:Buffer.from(value.key,'base64')}),provider=new WorkspaceDatabases(input.runtime);installDatabaseProvider(provider);const sourceRegistry=new ProjectRegistry(new Workspace(input.root,key(input.vault)),input.workspaceId),targetRegistry=new ProjectRegistry(new Workspace(input.target.root,key(input.target.vault)),input.target.id),selected=input.projects[0],storage=new ProjectStorage(selected.root,selected.projectId,key(selected.key)),rename=fs.rename;fs.rename=async(from,to)=>{if(from===storage.root&&to===input.destination)throw Object.assign(Error('Different filesystem'),{code:'EXDEV'});return rename(from,to);};syncBuiltinESMExports();await new ProjectWorkspaceMoves(sourceRegistry,targetRegistry,storage.projectId).run(storage,{...input.options,withProject:async(id,use)=>use(new ProjectStorage((await sourceRegistry.locate(id)).root,id,key(input.projects.find(project=>project.projectId===id).key))),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,key(input.books.find(book=>book.labBookId===id).key))),checkpoint:async stage=>{if(stage==='source-retired'){process.stdout.write('retired');await new Promise(()=>{});}}});`;
 try{
  child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});ended=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Retirement timeout: '+errors)),240000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Transfer exited before retirement: '+errors));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});const key=value=>({id:value.id,key:value.key.toString('base64')});child.stdin.end(JSON.stringify({runtime:f.runtime,root:f.root,vault:key(f.workspace.vault),workspaceId:f.registry.workspaceId,target:{root:f.targetRegistry.workspace.root,vault:key(f.targetRegistry.workspace.vault),id:f.targetRegistry.workspaceId},projects:f.projects.map(project=>({...project,key:key(project.key)})),books:f.books.map(book=>({...book,key:key(book.key)})),destination:f.destination,options:f.options}));});
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await ended;}f.restartProvider();await f.workspace.outline();}
 await fs.mkdir(f.source.root);const sentinel=path.join(f.source.root,'new-user-file.txt');await fs.writeFile(sentinel,'Independent replacement');
 assert.equal((await f.moves.resume(f.source.vault)).complete,true);assert.equal(await fs.readFile(sentinel,'utf8'),'Independent replacement');
 await assert.rejects(fs.stat(path.join(path.dirname(f.source.root),'.observanda-project-move-'+f.options.id)),{code:'ENOENT'});
 for(const book of f.books){const root=path.join(f.destination,path.relative(f.source.root,book.root));assert.deepEqual(await new LabBookStorage(root,book.labBookId,book.key).read(),book.before);}
 assert.equal((await f.registry.read()).value.relocated.length,2);assert.equal((await f.targetRegistry.read()).value.projects.length,2);
});


// Opt-in mounted-volume qualification uses only a newly created temporary child.
// Normal CI still exercises all deterministic cross-filesystem fault boundaries.
test('actual cross-volume workspace handoff resumes after publication with independent owner databases',{timeout:600000,skip:!process.env.OBSERVANDA_TEST_SECOND_VOLUME},async t=>{
 const f=await fixture(t,{destinationParent:process.env.OBSERVANDA_TEST_SECOND_VOLUME});
 assert.notEqual((await fs.stat(f.source.root)).dev,(await fs.stat(f.targetRegistry.workspace.root)).dev,'The destination must be a different mounted volume');
 await assert.rejects(f.moves.run(f.source,{...f.options,checkpoint:stage=>{if(stage==='registered')throw Error('Interrupted after destination publication');}}),/Interrupted after destination publication/);
 assert.equal((await f.moves.read()).ownerDirectoryVersion,2);
 await f.stopProvider();f.restartProvider();
 assert.equal((await f.moves.resume(f.source.vault)).complete,true);
 await tree(f,true);
 assert.equal((await f.moves.read()).released,true);
});
