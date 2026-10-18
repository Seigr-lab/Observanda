import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace} from '../src/storage.js';
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
