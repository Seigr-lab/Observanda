import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {clearVault} from '../src/encryption.js';

// One database per workspace: a copy gets a new cluster, and every copied
// project is activated in it, never carrying a cluster of its own.
test('a workspace copy activates its projects in the copy\'s own new cluster',{timeout:180000},async t=>{
 const {encryptedFixture}=await import('./browser/encrypted-fixture.js'),{createNotebook}=await import('../src/model.js'),{createWorkspaceAccess,takeCreatedVault}=await import('../src/access.js'),{initializeProjectLocation,ProjectStorage}=await import('../src/project-storage.js'),{ProjectRegistry}=await import('../src/project-registry.js'),{WorkspaceProjectCopy}=await import('../src/workspace-project-copy.js'),{WorkspaceDatabases}=await import('../src/workspace-databases.js'),{installDatabaseProvider}=await import('../src/workspace-database-context.js'),{catalogueBinding}=await import('../src/postgres-activation.js'),{assertOwnersInCluster}=await import('./owner-workspace-fixture.js'),{workDirectory}=await import('../scripts/work-directory.js');
 const directory=await mkdtemp(path.join(await workDirectory('test-work'),'observanda-copy-cluster-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),fixture=await encryptedFixture(directory,createNotebook('Workspace')),keys=[fixture.vault];
 t.after(async()=>{await provider.close();detach();await Promise.all(keys.map(clearVault));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=createNotebook('Independent project'),projectId=randomUUID();book.projects=[{id:projectId,title:'Independent project',parentId:null,description:'',share:false,logoId:null}];
 const access=await createWorkspaceAccess('','',fixture.deviceStore),key=takeCreatedVault(access);keys.push(key);
 const project=await initializeProjectLocation(path.join(fixture.workspace.root,'Independent project'),projectId,book,access,key),registry=new ProjectRegistry(fixture.workspace,(await fixture.workspace.outline()).metadata.id);
 await registry.attach(project,{expected:(await registry.read()).revision});const before=(await project.read()).book;
 const bundle=()=>new WorkspaceProjectCopy(fixture.workspace,{withProject:async(id,use)=>{assert.equal(id,projectId);return use(project);}}),destination=path.join(directory,'Activated copy');
 await bundle().copy(await bundle().plan(destination,{inspect:false}),{activateCatalogue:true});
 const copied=path.join(destination,'Independent project');
 await assertOwnersInCluster(destination,[copied],{notCluster:(await catalogueBinding(fixture.workspace.root)).cluster});
 const read=(await new ProjectStorage(copied,projectId,key).read()).book;assert.deepEqual(read.entries,before.entries);assert.equal(read.projects[0].id,projectId);
});
