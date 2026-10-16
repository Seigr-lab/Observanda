import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {copyWorkspaceTo,workspaceManifest,copyPlan,encryptedCopy} from '../src/locations.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {moveWorkspaceTo,finishWorkspaceMove,readMoveReceipt} from '../src/workspace-move.js';

async function fixture(t){
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'observanda-owned-transfer-')),owner=new WorkspaceDatabases({directory:path.join(parent,'application'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);let f;
 t.after(async()=>{await owner.close();detach();clearVault(f?.vault);await fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 f=await encryptedFixture(parent,sampleNotebook());await f.workspace.writeFile(path.join(f.workspace.root,'.observanda','original.bin'),Buffer.from([0,255,37]));
 return {...f,parent,owner};
}
test('copy and move transfer independent physical databases and leave unrelated workspaces usable',async t=>{
 const f=await fixture(t),source=f.workspace.root,before=await f.workspace.read(),copy=path.join(f.parent,'copy'),moved=path.join(f.parent,'moved');
 assert.equal((await workspaceManifest(source)).some(file=>file.path.startsWith('.observanda/postgresql/')),false);
 await copyWorkspaceTo(source,copy,{vault:f.vault,activateCatalogue:true});
 assert.notEqual((await catalogueBinding(source)).id,(await catalogueBinding(copy)).id);await fs.access(path.join(copy,'.observanda/postgresql/data/PG_VERSION'));
 const copyWorkspace=new Workspace(copy,f.vault);await copyWorkspace.update(book=>{book.title='Copy edits';return book;});assert.deepEqual(await f.workspace.read(),before);
 const result=await moveWorkspaceTo(source,moved,{vault:f.vault,activate:async root=>{
  await assert.rejects(f.workspace.read(),{code:'STORAGE_MOVED'});assert.deepEqual(await new Workspace(root,f.vault).read(),before);
 }});
 assert.equal(result.phase,'complete',JSON.stringify(result));await assert.rejects(fs.access(source),{code:'ENOENT'});
 assert.equal((await copyWorkspace.read()).book.title,'Copy edits');await f.owner.closeWorkspace(moved);assert.deepEqual(await new Workspace(moved,f.vault).read(),before);
});
test('interrupted owned move resumes without copying again and verifies retained history after destination edits',async t=>{
 const f=await fixture(t),source=f.workspace.root,destination=path.join(f.parent,'destination'),before=await f.workspace.read();
 await assert.rejects(moveWorkspaceTo(source,destination,{vault:f.vault,activate:()=>{throw Error('Interrupted activation');}}),/Interrupted activation/);
 assert.equal((await readMoveReceipt(destination)).phase,'verified');await assert.rejects(f.workspace.read(),{code:'STORAGE_MOVED'});
 const rename=fs.rename;
 fs.rename=async(from,to)=>{if(from===source)throw Object.assign(Error('Source folder busy'),{code:'EACCES'});return rename(from,to);};syncBuiltinESMExports();
 let result;try{result=await moveWorkspaceTo(source,destination,{vault:f.vault,activate:async()=>{}});}finally{fs.rename=rename;syncBuiltinESMExports();}
 assert.equal(result.phase,'cleanup',JSON.stringify(result));
 const target=new Workspace(destination,f.vault);assert.deepEqual(await target.read(),before);await target.update(book=>{book.description='New destination work';return book;});
 assert.equal((await finishWorkspaceMove(destination,{vault:f.vault})).phase,'complete');assert.equal((await target.read()).book.description,'New destination work');await assert.rejects(fs.access(source),{code:'ENOENT'});
});

test('owned databases support portable archives and separately keyed successor workspaces',async t=>{
 const f=await fixture(t),before=await f.workspace.read(),portable=path.join(f.parent,'portable'),successor=path.join(f.parent,'successor');
 await copyWorkspaceTo(f.workspace.root,portable,{vault:f.vault});
 assert.equal(await catalogueBinding(portable),null);await assert.rejects(fs.access(path.join(portable,'.observanda/postgresql')),{code:'ENOENT'});
 const access=await createWorkspaceAccess('','Synthetic successor password',f.deviceStore),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 await encryptedCopy(await copyPlan(f.workspace.root,successor),access,vault,f.vault);
 assert.deepEqual(await new Workspace(successor,vault).read(),before);assert.notEqual(vault.id,f.vault.id);await f.owner.closeWorkspace(successor);
 await assert.rejects(new Workspace(successor,f.vault).read());
 assert.deepEqual(await f.workspace.read(),before);await f.owner.closeWorkspace(f.workspace.root);
 assert.deepEqual(await new Workspace(portable,f.vault).read(),before);assert.equal((await catalogueBinding(portable)).placement,'workspace');
});
