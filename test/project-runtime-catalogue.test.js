import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {TestDeviceStore} from './device-fixture.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {assertProjectDatabaseStopped} from '../src/project-postgres.js';
import {scratchDatabase,databaseCapacity} from '../src/postgres.js';

test('catalogue and scoped scratch connections retain their real project runtime through draining and idle restart',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-runtime-')),book=sampleNotebook(),id=book.projects[0].id,deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN},projectRuntime:{maxIdle:0}}),detach=installDatabaseProvider(owner);let db,scratch;
 t.after(async()=>{await scratch?.close();await db?.close();await owner.close();detach();clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-runtime-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 book.title=book.projects[0].title='project';
 const storage=await initializeProjectLocation(path.join(directory,'project'),id,book,access,vault),before=await storage.outline();db=await storage.openCatalogue();await db.run('BEGIN');scratch=await db.scope(()=>scratchDatabase());assert.equal(owner.projects.stats().references,2);
 let stopped=false;const closing=owner.closeProject(storage.root).then(()=>stopped=true);await delay(50);assert.equal(stopped,false);assert.equal((await db.get('SELECT 37 AS value')).value,37);
 await db.close();db=null;await delay(50);assert.equal(stopped,false);assert.equal((await scratch.get('SELECT 41 AS value')).value,41);assert.equal(owner.projects.stats().references,1);
 await scratch.close();scratch=null;await closing;assert.equal(databaseCapacity().active,0);assert.equal(owner.projects.stats().open,0);await assertProjectDatabaseStopped(storage.root,id,vault);
 assert.equal((await storage.outline()).etag,before.etag);for(let i=0;owner.projects.stats().open&&i<200;i++)await delay(50);assert.equal(owner.projects.stats().open,0);await assertProjectDatabaseStopped(storage.root,id,vault);
});
