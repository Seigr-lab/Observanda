import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';import os from 'node:os';
import {mkdtemp,mkdir,rm,stat,unlink,readdir,readFile,writeFile,rename,symlink,cp} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {reconcileProjectFiles,PROJECT_TRANSFER_FILES} from '../src/project-transfer-files.js';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-transfer-files-')),vault={id:randomUUID(),key:randomBytes(32)},source=new Workspace(path.join(root,'source'),vault),target=new Workspace(path.join(root,'target'),vault),receipt={id:randomUUID(),filesVersion:1};
 t.after(async()=>{vault.key.fill(0);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-transfer-files-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 for(const storage of [source,target])await mkdir(path.join(storage.root,'.observanda'),{recursive:true});await source.writeFile(path.join(source.root,'workspace.observanda'),'descriptor');
 return {source,target,receipt,run:options=>reconcileProjectFiles(source,target,receipt,{controls:new Set(),projectRoots:[],...options})};
}
test('bounded file batches recover publication and deletion while preserving unchanged bytes',async t=>{
 const f=await fixture(t);
 for(let i=0;i<70;i++)await f.source.writeFile(path.join(f.source.root,'.observanda',i+'.bin'),'original '+i);
 let published=0;await assert.rejects(f.run({checkpoint:async stage=>{if(stage==='file'&&++published===3)throw Error('Interrupted publication');}}),/Interrupted publication/);
 await f.source.writeFile(path.join(f.source.root,'.observanda/0.bin'),'new bytes');await unlink(path.join(f.source.root,'.observanda/1.bin'));
 await f.run();assert.equal(await f.target.readFile(path.join(f.target.root,'.observanda/0.bin'),'utf8'),'new bytes');await assert.rejects(stat(path.join(f.target.root,'.observanda/1.bin')),{code:'ENOENT'});
 const unchanged=path.join(f.target.root,'.observanda/2.bin'),before=await stat(unchanged);
 await unlink(path.join(f.source.root,'.observanda/3.bin'));
 await assert.rejects(f.run({checkpoint:async stage=>{if(stage==='file-receipt')throw Error('Interrupted deletion');}}),/Interrupted deletion/);
 await f.run();await assert.rejects(stat(path.join(f.target.root,'.observanda/3.bin')),{code:'ENOENT'});assert.equal((await stat(unchanged)).mtimeMs,before.mtimeMs);assert.equal((await stat(unchanged)).ino,before.ino);
 assert.deepEqual(await readdir(path.join(f.target.root,PROJECT_TRANSFER_FILES,'staging')),[]);
});
test('file reconciliation refuses replacement files and tampered ownership receipts',async t=>{
 const f=await fixture(t),relative='.observanda/evidence.bin';await f.source.writeFile(path.join(f.source.root,relative),'first');await f.run();
 await f.target.writeFile(path.join(f.target.root,relative),'destination edits');await f.source.writeFile(path.join(f.source.root,relative),'source edits');
 await assert.rejects(f.run(),{code:'CONFLICT'});assert.equal(await f.target.readFile(path.join(f.target.root,relative),'utf8'),'destination edits');
 const file=path.join(f.target.root,PROJECT_TRANSFER_FILES,'0000000000.obsv');await writeFile(file,'untrusted receipt');await assert.rejects(f.run());assert.equal(await f.target.readFile(path.join(f.target.root,relative),'utf8'),'destination edits');
});


test('removing an obsolete staged file refuses a replaced parent directory',async t=>{
 const f=await fixture(t),folder='.observanda/files';await mkdir(path.join(f.source.root,folder));await f.source.writeFile(path.join(f.source.root,folder,'evidence.bin'),'Retained bytes');await f.run();
 await unlink(path.join(f.source.root,folder,'evidence.bin'));
 const inside=path.join(f.target.root,folder),outside=path.join(path.dirname(f.target.root),'external files');await rename(inside,outside);await symlink(outside,inside,process.platform==='win32'?'junction':'dir');
 await assert.rejects(f.run(),{code:'UNSAFE'});assert.ok(await stat(path.join(outside,'evidence.bin')));
});


test('earlier interrupted transfers retire only their own reserved stream files',async t=>{
 const f=await fixture(t);delete f.receipt.filesVersion;const parent=path.join(f.target.root,'.observanda');const owned=path.join(parent,'.stream-project-'+f.receipt.id),unrelated=path.join(parent,'keep.bin');await writeFile(owned,'Incomplete old stream');await writeFile(unrelated,'Keep this unrelated file');
 await f.run();await assert.rejects(stat(owned),{code:'ENOENT'});assert.equal((await stat(unrelated)).size,24);
});

for(const remove of [false,true])test('a parent replaced during '+(remove?'deletion':'publication')+' cannot redirect a nested owner transfer',async t=>{
 const f=await fixture(t),relative='.observanda/evidence',inside=path.join(f.target.root,relative),outside=path.join(path.dirname(f.target.root),'outside'),retained=path.join(path.dirname(f.target.root),'retained');
 await mkdir(path.join(f.source.root,relative));await f.source.writeFile(path.join(f.source.root,relative,'sample.bin'),'Reviewed source');
 if(remove){await f.run();await unlink(path.join(f.source.root,relative,'sample.bin'));}
 await mkdir(outside);await writeFile(path.join(outside,'sample.bin'),'Unrelated outside bytes');let exchanged=false;
 await assert.rejects(f.run({checkpoint:async stage=>{if(stage==='file-receipt'&&!exchanged){exchanged=true;await rename(inside,retained);await symlink(outside,inside,process.platform==='win32'?'junction':'dir');}}}),error=>['UNSAFE','STORAGE_COPY'].includes(error.code));
 assert.equal(exchanged,true);assert.equal(await readFile(path.join(outside,'sample.bin'),'utf8'),'Unrelated outside bytes');assert.deepEqual(await readdir(outside),['sample.bin']);
});

test('interrupted file reconciliation rejects an identical replacement owner root',async t=>{
 const f=await fixture(t),original=path.join(path.dirname(f.target.root),'original');await f.source.writeFile(path.join(f.source.root,'.observanda/sample.bin'),'Retained source');
 await assert.rejects(f.run({checkpoint:stage=>{if(stage==='file-receipt')throw Error('Interrupted receipt');}}),/Interrupted receipt/);assert.match(f.receipt.destinationIdentity,/^\d+:\d+$/);
 await rename(f.target.root,original);await cp(original,f.target.root,{recursive:true});await writeFile(path.join(f.target.root,'unrelated'),'Keep');
 await assert.rejects(f.run(),{code:'STORAGE_COPY'});assert.equal(await readFile(path.join(f.target.root,'unrelated'),'utf8'),'Keep');
 await rename(f.target.root,path.join(path.dirname(f.target.root),'replacement'));await rename(original,f.target.root);await f.run();assert.equal(await f.target.readFile(path.join(f.target.root,'.observanda/sample.bin'),'utf8'),'Retained source');
});
