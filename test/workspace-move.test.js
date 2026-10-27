import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {Workspace,workspaceFile} from '../src/storage.js';
import {initializeLocation,inspectLocation,workspaceManifest,copyPlan,copyWorkspace,copyWorkspaceTo} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {createAccess} from '../src/access.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {ResearchCatalogue,verifyCatalogueArchive} from '../src/research-catalogue.js';
import {withOperationProgress} from '../src/operation-progress.js';
import {planWorkspaceMove,moveWorkspace,moveWorkspaceTo,finishWorkspaceMove,readMoveReceipt} from '../src/workspace-move.js';

async function fixture(t,encrypted=false){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'observanda-move-test-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const f=encrypted?await encryptedFixture(directory,sampleNotebook()):{workspace:new Workspace(await initializeLocation(path.join(directory,'workspace'),sampleNotebook(),await createAccess()))};
 if(f.vault)t.after(()=>clearVault(f.vault));
 const source=f.workspace.root,destination=path.join(directory,'destination'),original=path.join(source,'.observanda','evidence.bin');
 await fs.writeFile(original,Buffer.from([0,255,17,42]));
 return {...f,directory,source,destination,original};
}
for(const encrypted of [false,true])test(`${encrypted?'encrypted':'plain'} move activates verified data before removing source and preserves identity`,async t=>{
 const f=await fixture(t,encrypted),before=await f.workspace.read(),binding=await catalogueBinding(f.source),plan=await planWorkspaceMove(f.source,f.destination),events=[];
 const result=await moveWorkspace(plan,{vault:f.vault,onProgress:e=>events.push(e),activate:async destination=>{
  await fs.access(f.source);if(encrypted)await assert.rejects(f.workspace.read(),{code:'STORAGE_MOVED'});
  assert.deepEqual(await new Workspace(destination,f.vault).read(),before);
  assert.deepEqual(await fs.readFile(path.join(destination,'.observanda','evidence.bin')),await fs.readFile(f.original));
 }});
 assert.equal(result.phase,'complete');await assert.rejects(fs.access(f.source),{code:'ENOENT'});
 assert.deepEqual(await catalogueBinding(f.destination),binding,'Move retains the existing database, without cloning an active schema');
 const transfers=events.filter(e=>e.transfer);assert.ok(transfers.length);
 assert.equal(events.some(e=>['archive','read-archive'].includes(e.stage)),false,'Move must not export and restore the database it retains');
 assert.equal(transfers.at(-1).transfer.bytes,plan.fileBytes);assert.equal(transfers.at(-1).transfer.files,plan.transferFiles);
 for(let i=1;i<transfers.length;i++){assert.ok(transfers[i].transfer.bytes>=transfers[i-1].transfer.bytes);assert.ok(transfers[i].transfer.files>=transfers[i-1].transfer.files);}
 const next=new Workspace(f.destination,f.vault),current=await next.read();current.book.description='Continued after move';await next.save(current.book,current.etag);
 assert.equal((await next.read()).book.description,'Continued after move');
 await fs.mkdir(f.source);await fs.writeFile(path.join(f.source,'unrelated'),'Do not delete a reused source path');
 assert.equal((await finishWorkspaceMove(f.destination)).phase,'complete');assert.equal(await fs.readFile(path.join(f.source,'unrelated'),'utf8'),'Do not delete a reused source path');
});

test('copy and use restores and verifies once; portable copies remain independently restorable',async t=>{
 const f=await fixture(t,true),before=await f.workspace.read(),verify=ResearchCatalogue.prototype.verify,measurements=[];
 for(let i=0;i<12;i++){const current=await f.workspace.read();current.book.description='Retained revision '+i;await f.workspace.save(current.book,current.etag);}
 await fs.writeFile(f.original,Buffer.alloc(16*1024*1024,73));
 const original=await f.workspace.read();
 try{
  for(const activateCatalogue of [false,true]){
   const root=path.join(f.directory,activateCatalogue?'active-copy':'portable-copy'),events=[];let verifications=0;
   ResearchCatalogue.prototype.verify=async function(...args){verifications++;return verify.apply(this,args);};
   const start=performance.now();
   await withOperationProgress(e=>events.push(e),async()=>{
    await copyWorkspaceTo(f.source,root,{vault:f.vault,activateCatalogue});
    if(!activateCatalogue){assert.equal(await catalogueBinding(root),null);await fs.access(path.join(root,CATALOGUE_ARCHIVE));}
    else await assert.rejects(fs.access(path.join(root,CATALOGUE_ARCHIVE)),{code:'ENOENT'});
    assert.deepEqual(await new Workspace(root,f.vault).read(),original);
   });
   assert.equal(verifications,activateCatalogue?1:2);
   // Schema preparation can report the same zero-byte stage more than once.
   const archiveProgress=events.filter(e=>e.stage==='read-archive');
   assert.equal(archiveProgress.filter((e,index)=>index===0||e.completed<archiveProgress[index-1].completed).length,activateCatalogue?1:2);
   assert.notEqual((await catalogueBinding(root)).id,(await catalogueBinding(f.source)).id);
   measurements.push({path:activateCatalogue?'Copy and use':'Portable copy then open',milliseconds:Math.round(performance.now()-start),verifications});
   const copied=new Workspace(root,f.vault),edit=await copied.read();edit.book.description='Independent copy edit';await copied.save(edit.book,edit.etag);
   assert.deepEqual(await f.workspace.read(),original);
  }
 }finally{ResearchCatalogue.prototype.verify=verify;}
 assert.equal(original.book.id,before.book.id);t.diagnostic(JSON.stringify(measurements));
});

for(const reuseCatalogue of [false,true])test(`${reuseCatalogue?'move':'copy and use'} verification failure keeps source and blocks opening incomplete destination`,async t=>{
 const f=await fixture(t,true),before=await f.workspace.read(),verify=ResearchCatalogue.prototype.verify;
 ResearchCatalogue.prototype.verify=async()=>{throw Error('Synthetic transfer verification failure');};
 try{
  await assert.rejects(copyWorkspaceTo(f.source,f.destination,{vault:f.vault,reuseCatalogue,activateCatalogue:!reuseCatalogue}),error=>error.message==='Synthetic transfer verification failure'||error.code==='CATALOGUE_DAMAGED');
 }finally{ResearchCatalogue.prototype.verify=verify;}
 assert.deepEqual(await f.workspace.read(),before);
 await assert.rejects(inspectLocation(f.destination),{code:'STORAGE_INCOMPLETE'});
 await assert.rejects(new Workspace(f.destination,f.vault).read(),{code:'STORAGE_INCOMPLETE'});
 if(!reuseCatalogue)assert.equal(await catalogueBinding(f.destination),null,'A failed independent copy never publishes its database');
});
test('a failed activation retains the source and resumes the verified transfer without another copy',async t=>{
 const f=await fixture(t,true),plan=await planWorkspaceMove(f.source,f.destination),before=await f.workspace.read();
 await assert.rejects(moveWorkspace(plan,{vault:f.vault,activate:async()=>{throw Error('Activation unavailable');}}),/Activation unavailable/);
 await fs.access(f.source);await assert.rejects(f.workspace.read(),{code:'STORAGE_MOVED'});assert.deepEqual(await new Workspace(f.destination,f.vault).read(),before);assert.equal((await readMoveReceipt(f.destination)).phase,'verified');
 const resume=await planWorkspaceMove(f.source,f.destination),events=[];assert.equal(resume.resume,true);
 assert.equal((await moveWorkspace(resume,{vault:f.vault,onProgress:e=>events.push(e),activate:async()=>{}})).phase,'complete');
 assert.equal(events.some(e=>e.stage==='copy-file'),false);
});
test('source changes stop cleanup; restoring reviewed bytes allows cleanup without another transfer',async t=>{
 const f=await fixture(t),plan=await planWorkspaceMove(f.source,f.destination),original=await fs.readFile(f.original);
 const result=await moveWorkspace(plan,{activate:async()=>{await fs.writeFile(f.original,'New source bytes');}});
 assert.equal(result.phase,'cleanup');assert.equal(result.error.code,'CONFLICT');assert.equal(await fs.readFile(f.original,'utf8'),'New source bytes');
 assert.deepEqual(await fs.readFile(path.join(f.destination,'.observanda','evidence.bin')),original);
 await fs.writeFile(f.original,original);const events=[];
 assert.equal((await finishWorkspaceMove(f.destination,{onProgress:e=>events.push(e)})).phase,'complete');assert.equal(events.some(e=>e.stage==='copy-file'),false);
});
test('interrupted removal resumes its own retired folder and never deletes a newly reused source path',async t=>{
 const f=await fixture(t),plan=await planWorkspaceMove(f.source,f.destination),unlink=fs.unlink;let failed=false;
 fs.unlink=async file=>{if(String(file).includes('.observanda-move-')&&String(file).endsWith('evidence.bin')){failed=true;throw Object.assign(Error('Locked file'),{code:'EACCES'});}return unlink(file);};syncBuiltinESMExports();
 let result;try{result=await moveWorkspace(plan,{activate:async()=>{}});}finally{fs.unlink=unlink;syncBuiltinESMExports();}
 assert.equal(failed,true);assert.equal(result.phase,'cleanup');await assert.rejects(fs.access(f.source),{code:'ENOENT'});
 assert.equal((await inspectLocation(f.destination)).kind,'workspace');
 await fs.mkdir(f.source);await fs.writeFile(path.join(f.source,'keep'),'Unrelated new data');
 assert.equal((await finishWorkspaceMove(f.destination)).phase,'complete');assert.equal(await fs.readFile(path.join(f.source,'keep'),'utf8'),'Unrelated new data');
});
test('failed source retirement blocks old writers and cleanup still works after authoring in the destination',async t=>{
 const f=await fixture(t,true),plan=await planWorkspaceMove(f.source,f.destination),rename=fs.rename;let failed=false;
 fs.rename=async(from,to)=>{if(from===f.source){failed=true;throw Object.assign(Error('Folder is in use'),{code:'EACCES'});}return rename(from,to);};syncBuiltinESMExports();
 let result;try{result=await moveWorkspace(plan,{vault:f.vault,activate:async()=>{}});}finally{fs.rename=rename;syncBuiltinESMExports();}
 assert.equal(failed,true);assert.equal(result.phase,'cleanup');await fs.access(f.original);
 await assert.rejects(f.workspace.read(),{code:'STORAGE_MOVED'});await assert.rejects(f.workspace.withLock(()=>{}),{code:'STORAGE_MOVED'});
 const destination=new Workspace(f.destination,f.vault),current=await destination.read();current.book.description='New destination work';await destination.save(current.book,current.etag);
 assert.equal((await finishWorkspaceMove(f.destination,{vault:f.vault})).phase,'complete');assert.equal((await destination.read()).book.description,'New destination work');
});

test('cleanup retry keeps remaining original bytes if their verified destination was subsequently damaged',async t=>{
 const f=await fixture(t),plan=await planWorkspaceMove(f.source,f.destination),unlink=fs.unlink;
 fs.unlink=async file=>{if(String(file).includes('.observanda-move-')&&String(file).endsWith('evidence.bin'))throw Object.assign(Error('Locked file'),{code:'EACCES'});return unlink(file);};syncBuiltinESMExports();
 try{assert.equal((await moveWorkspace(plan,{activate:async()=>{}})).phase,'cleanup');}finally{fs.unlink=unlink;syncBuiltinESMExports();}
 const original=path.join(f.directory,'.observanda-move-'+plan.id,'.observanda','evidence.bin'),copied=path.join(f.destination,'.observanda','evidence.bin'),bytes=await fs.readFile(original);
 await fs.writeFile(copied,'Damaged after verification');
 assert.equal((await finishWorkspaceMove(f.destination)).error.code,'STORAGE_COPY');assert.deepEqual(await fs.readFile(original),bytes);
 await fs.writeFile(copied,bytes);assert.equal((await finishWorkspaceMove(f.destination)).phase,'complete');
});
test('a moved workspace supports subsequent independent backups and moves without carrying old cleanup instructions',async t=>{
 const f=await fixture(t,true),plan=await planWorkspaceMove(f.source,f.destination);
 await moveWorkspace(plan,{vault:f.vault,activate:async()=>{}});
 const backup=path.join(f.directory,'backup');await copyWorkspace(await copyPlan(f.destination,backup),{vault:f.vault});
 assert.equal(await readMoveReceipt(backup),null);assert.equal((await new Workspace(backup,f.vault).read()).book.id,(await new Workspace(f.destination,f.vault).read()).book.id);
 const next=path.join(f.directory,'next');assert.equal((await moveWorkspace(await planWorkspaceMove(f.destination,next),{vault:f.vault,activate:async()=>{}})).phase,'complete');
 assert.equal((await readMoveReceipt(next)).source,f.destination);await fs.access(backup);await assert.rejects(fs.access(f.destination),{code:'ENOENT'});
});
test('move rejects unrelated root files, changed reviews and nested destinations without deleting anything',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.source,'unrelated'),'Keep');
 await assert.rejects(planWorkspaceMove(f.source,f.destination),{code:'STORAGE_MOVE_CONTENTS'});await fs.unlink(path.join(f.source,'unrelated'));
 await assert.rejects(planWorkspaceMove(f.source,path.join(f.source,'nested')),{code:'STORAGE_PATH'});
 const plan=await planWorkspaceMove(f.source,f.destination);await fs.writeFile(f.original,'Changed after review');const manifest=await workspaceManifest(f.source);
 await assert.rejects(moveWorkspace(plan,{activate:async()=>assert.fail('Must not activate')}),{code:'CONFLICT'});
 assert.deepEqual(await workspaceManifest(f.source),manifest);await assert.rejects(fs.access(f.destination),{code:'ENOENT'});
});

test('direct copy and move inspect and transfer automatically without a separate review inventory',async t=>{
 const f=await fixture(t,true),before=await f.workspace.read(),copied=path.join(f.directory,'copied'),events=[];
 await copyWorkspaceTo(f.source,copied,{vault:f.vault,activateCatalogue:true,onProgress:event=>events.push(event)});
 assert.deepEqual(await f.workspace.read(),before);assert.deepEqual(await new Workspace(copied,f.vault).read(),before);
 assert.equal(events.some(event=>event.stages.includes('review-workspace')),false);
 // Source inventory hashes report aggregate progress; only destination
 // verification emits a per-file stage. Progress counts are not integrity proof.
 assert.equal(events.filter(event=>event.stage==='verify-file'&&event.item==='evidence.bin'&&event.completed===0).length,1);
 assert.deepEqual(await fs.readFile(path.join(copied,'.observanda','evidence.bin')),await fs.readFile(f.original));
 assert.equal(events.find(event=>event.transfer)?.transfer.totalFiles,undefined);
 const transferred=events.filter(event=>event.transfer).at(-1).transfer;assert.ok(transferred.files>0);assert.equal(transferred.files,transferred.totalFiles);assert.equal(transferred.bytes,transferred.totalBytes);
 events.length=0;
 assert.equal((await moveWorkspaceTo(copied,f.destination,{vault:f.vault,onProgress:event=>events.push(event),activate:async root=>{assert.deepEqual(await new Workspace(root,f.vault).read(),before);}})).phase,'complete');
 assert.equal(events.some(event=>event.stages.includes('review-workspace')),false);await assert.rejects(fs.access(copied),{code:'ENOENT'});assert.deepEqual(await f.workspace.read(),before);
 assert.deepEqual(await fs.readFile(path.join(f.destination,'.observanda','evidence.bin')),await fs.readFile(f.original));
});


test('archive checks verify an existing binding and reject a different requested identity',async t=>{
 const f=await fixture(t,true),descriptor=JSON.parse(await f.workspace.readFile(await workspaceFile(f.source),'utf8')),verify=ResearchCatalogue.prototype.verify;let calls=0;
 ResearchCatalogue.prototype.verify=async function(...args){calls++;return verify.apply(this,args);};
 try{await verifyCatalogueArchive(f.workspace,descriptor);assert.equal(calls,1);}
 finally{ResearchCatalogue.prototype.verify=verify;}
 const portable=path.join(f.directory,'portable identity check');await copyWorkspaceTo(f.source,portable,{vault:f.vault});
 await assert.rejects(verifyCatalogueArchive(new Workspace(portable,f.vault),{...descriptor,workspaceId:'00000000-0000-4000-8000-000000000000'}),{code:'CATALOGUE_DAMAGED'});
 assert.equal(await catalogueBinding(portable),null);assert.equal((await f.workspace.read()).book.id,descriptor.workspaceId);
});
