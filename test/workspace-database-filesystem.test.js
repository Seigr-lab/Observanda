// Opt-in qualification against a user's selected storage filesystem. All data
// belongs to one newly created, explicitly bounded temporary directory.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,rm,rename,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {workspaceDatabaseLease} from '../src/workspace-database-lease.js';
import {Workspace} from '../src/storage.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';

test('selected filesystem supports owned database creation, exclusive access, shutdown and folder relocation',{skip:!process.env.OBSERVANDA_QUALIFY_STORAGE_ROOT},async t=>{
 const base=await realpath(process.env.OBSERVANDA_QUALIFY_STORAGE_ROOT),directory=await mkdtemp(path.join(base,'.observanda-database-qualification-'));
 const owner=new WorkspaceDatabases({directory:path.resolve('.local','postgresql'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);let f;
 t.after(async()=>{await owner.close();detach();clearVault(f?.vault);if(path.relative(base,await realpath(path.dirname(directory)))!==''||!path.basename(directory).startsWith('.observanda-database-qualification-'))throw Error('Unexpected qualification path');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 // Scratch state stays in the system temp directory. Only this disposable
 // workspace's database and files are written to the selected filesystem.
 await mkdir(path.join(directory,'fixture'));f=await encryptedFixture(path.join(directory,'fixture'),sampleNotebook());
 const before=await f.workspace.read();await f.workspace.update(book=>{book.description='Filesystem qualification';return book;});
 await assert.rejects(workspaceDatabaseLease(path.join(f.workspace.root,'.observanda','postgresql')));
 const config=await readFile(path.join(f.workspace.root,'.observanda','postgresql','service.observanda'));assert.equal(config.includes(Buffer.from('appPassword')),false);
 await owner.closeWorkspace(f.workspace.root);const moved=path.join(directory,'moved');await rename(f.workspace.root,moved);
 const next=new Workspace(moved,f.vault),after=await next.read();assert.equal(after.book.id,before.book.id);assert.equal(after.book.description,'Filesystem qualification');
 await next.catalogue(store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:before.book.id}));
 t.diagnostic('Creation, encrypted research verification, filesystem lease and clean stopped-folder relocation passed. This does not establish power-loss durability of the NAS or its server configuration.');
});
