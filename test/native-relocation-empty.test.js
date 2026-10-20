import '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {clearVault} from '../src/encryption.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {ProjectRenames} from '../src/project-rename.js';
import {nativeRelocationOwners} from '../src/native-relocation-state.js';

test('native empty-project rename adopts an authenticated empty book pin',{timeout:120000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-empty-relocation-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime);let vault,key;
 t.after(async()=>{await runtime.close();detach();clearVault(vault);clearVault(key);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-empty-relocation-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const metadata=createNotebook('Empty Project Workspace'),fixture=await encryptedFixture(path.join(directory,metadata.title),metadata),registry=new ProjectRegistry(fixture.workspace,metadata.id);vault=fixture.vault;
 const projectId=randomUUID(),{project}=await new ProjectCreation(registry,fixture.deviceStore).create({id:randomUUID(),username:'',password:'',project:{id:projectId,title:'Empty Project',description:'',parentId:null,share:false,logoId:null}});key=await verifyAccess(await readAccess(project.root),'','',{deviceStore:fixture.deviceStore});const source=new ProjectStorage(project.root,projectId,key),renames=new ProjectRenames(registry,projectId);
 assert.equal(await new LabBookRegistry(source).version(),'new');const result=await renames.run(source,{id:randomUUID(),name:'Empty Renamed Project',expectedName:'Empty Project'}),value=await renames.read();assert.equal(result.complete,true);assert.equal(value.ownerDirectoryVersion,2);assert.equal(value.owners.count,1);assert.equal(value.ownerKeys.count,0);assert.equal(value.keysReleased,true);assert.match((await nativeRelocationOwners(registry,value).get('')).bookRevision,/^[a-f0-9]{64}$/);assert.equal((await new ProjectStorage(result.project.root,projectId,key).outline()).metadata.projects[0].title,'Empty Renamed Project');
});
