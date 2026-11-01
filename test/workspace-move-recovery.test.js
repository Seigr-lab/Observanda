import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {nativeMutationFailure} from './fixtures/native-mutation-failure.js';
import {moveWorkspaceTo,readMoveReceipt,finishWorkspaceMove} from '../src/workspace-move.js';
import {authorizeWorkspaceMove,authorizedWorkspaceMove} from '../src/workspace-move-authorization.js';
import {recoverWorkspaceMove} from '../src/workspace-move-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {WORKSPACE_MOVE_AUTHORIZATION} from '../src/workspace-transfer-controls.js';
import {MOVE_RECEIPT} from '../src/workspace-move-state.js';
import {startServer} from '../src/server.js';

async function directory(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'observanda-move-recovery-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));return root;}
async function pending(t){
 const root=await directory(t),f=await encryptedFixture(root,sampleNotebook()),destination=path.join(root,'destination');t.after(()=>clearVault(f.vault));
 const original=path.join(f.workspace.root,'.observanda/evidence.bin'),bytes=Buffer.from('Retained synthetic evidence');await fs.writeFile(original,bytes);
 const result=await nativeMutationFailure(async(operation,file)=>{if(operation==='remove'&&file.endsWith('evidence.bin'))throw Object.assign(Error('Synthetic locked original'),{code:'EACCES'});},()=>moveWorkspaceTo(f.workspace.root,destination,{vault:f.vault,activate:async()=>{}}));
 assert.equal(result.phase,'cleanup');const receipt=await readMoveReceipt(destination),retired=path.join(root,'.observanda-move-'+receipt.id),target=new Workspace(destination,f.vault);
 assert.equal(await authorizedWorkspaceMove(target,receipt),true);
 return {...f,root,destination,receipt,retired,target,bytes,original:path.join(retired,'.observanda/evidence.bin'),copy:path.join(destination,'.observanda/evidence.bin')};
}
test('automatic retirement authority binds the exact move and original identity',async t=>{
 const root=await directory(t);await fs.mkdir(path.join(root,'.observanda'));const vault={id:randomUUID(),key:randomBytes(32)},workspace=new Workspace(root,vault);t.after(()=>clearVault(vault));
 const receipt={id:randomUUID(),source:path.join(path.dirname(root),'original'),destination:root,sourceIdentity:'123:456',phase:'verified',fingerprint:'a'.repeat(64)};
 assert.equal(await authorizedWorkspaceMove(workspace,receipt),false);await authorizeWorkspaceMove(workspace,receipt);await authorizeWorkspaceMove(workspace,receipt);
 assert.equal(await authorizedWorkspaceMove(workspace,{...receipt,phase:'cleanup',retired:true,error:{code:'IO'}}),true);
 for(const change of [{source:root+'-different'},{sourceIdentity:'123:457'},{fingerprint:'b'.repeat(64)},{destination:root+'-different'}])await assert.rejects(authorizedWorkspaceMove(workspace,{...receipt,...change}),{code:'STORAGE_MOVE_STATE'});
 const file=path.join(root,WORKSPACE_MOVE_AUTHORIZATION),bytes=await fs.readFile(file);bytes[bytes.length-1]^=1;await fs.writeFile(file,bytes);await assert.rejects(authorizedWorkspaceMove(workspace,receipt));
});
test('ordinary openings and unsigned move receipts never schedule deletion',async t=>{
 const root=await directory(t);await fs.mkdir(path.join(root,'.observanda'));const vault={id:randomUUID(),key:randomBytes(32)},workspace=new Workspace(root,vault);t.after(()=>clearVault(vault));
 const queue=new Proxy({},{get(){assert.fail('No job database work should be needed');}});
 assert.equal(await recoverWorkspaceMove(workspace,queue),null);
 const receipt={version:1,id:randomUUID(),source:root+'-source',destination:root,sourceIdentity:'1:2',phase:'cleanup',inventorySalt:randomUUID(),fingerprint:'a'.repeat(64),fingerprintFiles:'b'.repeat(64),fileCount:0,bytes:0,transferFiles:0,fileBytes:0};
 await fs.writeFile(path.join(root,MOVE_RECEIPT),JSON.stringify(receipt));assert.equal(await recoverWorkspaceMove(workspace,queue),null);
});
test('recovery refuses changed destination bytes, retries on later opening and respects cancellation',async t=>{
 const f=await pending(t),jobs=workspaceJobs(f.target);t.after(()=>jobs.stop());
 const first=await jobs.recover();assert.equal(first.state,'queued');assert.equal((await jobs.recover()).id,first.id);
 await jobs.queue.control(first.id,'cancel');await jobs.stop();assert.equal((await jobs.recover()).state,'cancelled');assert.deepEqual(await fs.readFile(f.original),f.bytes);
 await jobs.queue.control(first.id,'retry');await fs.writeFile(f.copy,'Changed destination');jobs.worker.enabled=true;await jobs.worker.runOnce();jobs.worker.enabled=false;
 assert.equal((await jobs.queue.read(first.id)).state,'failed');assert.deepEqual(await fs.readFile(f.original),f.bytes);
 await fs.writeFile(f.copy,f.bytes);await jobs.stop();assert.equal((await jobs.recover()).state,'queued');
 await fs.mkdir(f.workspace.root);await fs.writeFile(path.join(f.workspace.root,'unrelated'),'Keep reused folder');jobs.worker.enabled=true;await jobs.worker.runOnce();jobs.worker.enabled=false;
 assert.equal((await jobs.queue.read(first.id)).state,'completed');assert.equal((await readMoveReceipt(f.destination)).phase,'complete');await assert.rejects(fs.access(f.retired),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(f.workspace.root,'unrelated'),'utf8'),'Keep reused folder');
});
test('a substituted retirement directory is preserved even when it carries a copied marker',async t=>{
 const f=await pending(t),saved=f.retired+'-saved';await fs.rename(f.retired,saved);await fs.cp(saved,f.retired,{recursive:true});
 const result=await finishWorkspaceMove(f.destination,{vault:f.vault,requireAuthorization:true});assert.equal(result.phase,'cleanup');assert.equal(result.error.code,'STORAGE_MOVE_STATE');assert.deepEqual(await fs.readFile(f.original),f.bytes);assert.deepEqual(await fs.readFile(path.join(saved,'.observanda/evidence.bin')),f.bytes);
});
test('opening the verified destination automatically finishes interrupted cleanup',async t=>{
 const f=await pending(t),app=await startServer({root:f.destination,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(f.root,'prefs.json')});t.after(()=>app.close());
 const response=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(response.status,200);await response.json();
 const until=Date.now()+25000;let receipt;do{receipt=await readMoveReceipt(f.destination);if(receipt.phase==='complete')break;await delay(50);}while(Date.now()<until);
 assert.equal(receipt.phase,'complete');await assert.rejects(fs.access(f.retired),{code:'ENOENT'});assert.deepEqual(await fs.readFile(f.copy),f.bytes);
});

test('activation recovery and the original move caller share one completed retirement',async t=>{
 const root=await directory(t),f=await encryptedFixture(root,sampleNotebook()),destination=path.join(root,'destination');t.after(()=>clearVault(f.vault));
 const result=await moveWorkspaceTo(f.workspace.root,destination,{vault:f.vault,activate:async()=>{
  assert.equal((await finishWorkspaceMove(destination,{vault:f.vault,requireAuthorization:true})).phase,'complete');
 }});
 assert.equal(result.phase,'complete');assert.equal((await readMoveReceipt(destination)).phase,'complete');await assert.rejects(fs.access(f.workspace.root),{code:'ENOENT'});
});
