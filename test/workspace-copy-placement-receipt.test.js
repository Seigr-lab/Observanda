import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace,serialize} from '../src/storage.js';
import {WorkspaceCopyRecovery} from '../src/workspace-copy-recovery.js';
import {createKeyring} from '../src/security/keyring.js';
import {clearVault} from '../src/encryption.js';

test('authenticated copy receipts version literal placement and preserve exact legacy continuation',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-placement-')),vault={id:randomUUID(),key:randomBytes(32)},source=new Workspace(path.join(directory,'Source'),vault),encryption=await createKeyring({password:'Synthetic recovery password'});
 t.after(async()=>{clearVault(vault);clearVault(encryption.vault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-copy-placement-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await mkdir(path.join(source.root,'.observanda'),{recursive:true});
 const owner={projectId:randomUUID(),root:path.join(source.root,'Project'),parentId:null,namespaceId:randomUUID(),vaultId:randomUUID()},membership={revision:'saved-directory',value:{projects:[owner]}};
 for(const [name,extra,version] of [['legacy',{},1],['literal',{projectPlacement:2},3],['encrypted',{projectPlacement:2,encrypted:true},3]]){
  const destination=path.join(directory,name),plan={source:source.root,destination,inventorySalt:randomUUID(),...extra},options=extra.encrypted?{encryptionAccess:encryption.value}:{},recovery=new WorkspaceCopyRecovery(source,destination,options);
  await recovery.run(plan,membership,async checkpoint=>{assert.equal(checkpoint.state.version,version);});
  const saved=await recovery.read();assert.equal(saved.version,version);assert.equal(saved.plan.projectPlacement,extra.projectPlacement);assert.equal(saved.plan.encrypted,extra.encrypted);
  assert.deepEqual((await new WorkspaceCopyRecovery(source,destination,options).read()),saved);
  await new WorkspaceCopyRecovery(source,destination,options).run(plan,membership,async checkpoint=>assert.equal(checkpoint.transferId(owner.projectId),saved.transfers[owner.projectId]));
  if(version===3){
   await recovery.save({...saved,version:1});await assert.rejects(recovery.read(),{code:'STORAGE_COPY'});
   await recovery.save({...saved,plan:{...saved.plan,projectPlacement:undefined}});await assert.rejects(recovery.read(),{code:'STORAGE_COPY'});
  }else {await recovery.save({...saved,plan:{...saved.plan,projectPlacement:2}});await assert.rejects(recovery.read(),{code:'STORAGE_COPY'});}
  if(extra.encrypted){await recovery.save({...saved,encryptionAccess:undefined});await assert.rejects(recovery.read(),{code:'STORAGE_COPY'});await recovery.save(saved);await assert.rejects(new WorkspaceCopyRecovery(source,destination).run(plan,membership,async()=>assert.fail('Changed access must not resume')),{code:'CONFLICT'});}
  await recovery.save({...saved,version:4});await assert.rejects(recovery.read(),{code:'STORAGE_COPY'});await recovery.save(saved);assert.deepEqual(await recovery.read(),saved);
 }
});


test('an older interrupted portable receipt publishes its upgraded directory without activating the destination',{timeout:120000},async t=>{
 const {encryptedFixture}=await import('./browser/encrypted-fixture.js'),{createNotebook}=await import('../src/model.js'),{createWorkspaceAccess,takeCreatedVault}=await import('../src/access.js'),{initializeProjectLocation}=await import('../src/project-storage.js'),{ProjectRegistry}=await import('../src/project-registry.js'),{WorkspaceProjectCopy}=await import('../src/workspace-project-copy.js'),{WorkspaceDatabases}=await import('../src/workspace-databases.js'),{installDatabaseProvider}=await import('../src/workspace-database-context.js'),{catalogueBinding}=await import('../src/postgres-activation.js');
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-placement-native-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),fixture=await encryptedFixture(directory,createNotebook('Workspace')),keys=[fixture.vault];
 t.after(async()=>{await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-copy-placement-native-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=createNotebook('External project'),projectId=randomUUID();book.projects=[{id:projectId,title:'External project',description:'',share:false,logoId:null}];
 const access=await createWorkspaceAccess('','Independent project password',fixture.deviceStore),key=takeCreatedVault(access);keys.push(key);const project=await initializeProjectLocation(path.join(directory,'External project'),projectId,book,access,key),registry=new ProjectRegistry(fixture.workspace,(await fixture.workspace.outline()).metadata.id);
 const member={projectId,root:project.root,parentId:null,namespaceId:book.id,vaultId:key.id,summary:null};
 const deleted=Array.from({length:2},()=>({projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),operationId:randomUUID()})).sort((a,b)=>a.projectId>b.projectId?-1:1);
 await fixture.workspace.writeFile(registry.file,serialize({version:7,workspaceId:registry.workspaceId,projects:[member],deleted,relocated:[],aliases:null}));
 const original=await registry.read(),destination=path.join(directory,'Portable copy'),plan={source:fixture.workspace.root,destination,inventorySalt:randomUUID(),projectPlacement:2,portable:true,projectRoots:[],projectRegistryRevision:original.revision,sourceRevision:(await fixture.workspace.outline()).etag},recovery=new WorkspaceCopyRecovery(fixture.workspace,destination);
 await recovery.run(plan,original,async()=>{});const pending=await recovery.read();assert.equal(pending.version,3);const transferId=pending.transfers[projectId];
 let interrupted=false;const bundle=new WorkspaceProjectCopy(fixture.workspace,{withProject:async(id,use)=>{assert.equal(id,projectId);return use(project);},checkpoint:async stage=>{if(stage==='workspace-registry'&&!interrupted){interrupted=true;throw Error('Registry publication interrupted');}}});await assert.rejects(bundle.copy(plan),/Registry publication interrupted/);assert.equal(interrupted,true);assert.equal(await catalogueBinding(destination),null);await bundle.copy(await bundle.plan(destination,{portable:true,inspect:false}));
 const complete=await recovery.read();assert.equal(complete.version,3);assert.equal(complete.phase,'published');assert.equal(complete.transfers[projectId],transferId);
 const copied=new Workspace(destination,fixture.vault);assert.equal(await catalogueBinding(destination),null);assert.equal(await catalogueBinding(path.join(destination,'External project')),null);assert.equal(JSON.parse(await copied.readFile(path.join(destination,'.observanda/project-registry.observanda'),'utf8')).version,8);
 const finalRegistry=new ProjectRegistry(copied,registry.workspaceId);assert.equal((await finalRegistry.state(projectId)).entry.root,path.join(destination,'External project'));assert.deepEqual(await registry.read(),original);
});
