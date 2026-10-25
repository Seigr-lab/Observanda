import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {interruptWorkspace} from './fixtures/interrupt-workspace.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace,workspaceFile,atomicWrite,serialize} from '../src/storage.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {ResearchCatalogue,rekeyCatalogue} from '../src/research-catalogue.js';
import {catalogueStamp,CATALOGUE_FILE,CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {CATALOGUE_ACTIVATION} from '../src/postgres-activation.js';
import {WorkspaceCopyRecovery} from '../src/workspace-copy-recovery.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-rekey-archive-')),f=await encryptedFixture(directory,upgradeNotebook(sampleNotebook()));
 const access=await createWorkspaceAccess('','synthetic archive recovery password',f.deviceStore),vault=takeCreatedVault(access),destination=path.join(directory,'fresh');
 t.after(async()=>{clearVault(f.vault);clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-rekey-archive-'));await rm(directory,{recursive:true,force:true});});
 return {...f,directory,destination,access,freshVault:vault,before:await f.workspace.read(),stamp:await catalogueStamp(f.workspace.root)};
}
async function sourceUnchanged(f){assert.deepEqual(await f.workspace.read(),f.before);assert.deepEqual(await catalogueStamp(f.workspace.root),f.stamp);}
const absent=file=>assert.rejects(readFile(file),{code:'ENOENT'});

test('rekey rejects options that could request unchecked output',async()=>{
 for(const options of [null,[],false,{verify:false},{activate:'yes'},{activate:true,verify:false},{afterArchive:()=>{}},{activate:false,afterArchive:()=>{}},{activate:true,afterArchive:true}]){
  await assert.rejects(rekeyCatalogue(null,null,null,options),{code:'INVALID'});
 }
});

test('connected fresh-key copying audits the exported archive exactly once before publishing',async t=>{
 const f=await fixture(t),verify=ResearchCatalogue.prototype.verify;let audits=0,published=false;
 t.mock.method(ResearchCatalogue.prototype,'verify',async function(...args){
  if(this.workspace.root===f.destination){
   audits++;assert.equal(published,false);assert.ok((await readFile(path.join(f.destination,CATALOGUE_ARCHIVE))).length>0);
   await absent(path.join(f.destination,CATALOGUE_FILE));await readFile(path.join(f.destination,'.observanda/copy-in-progress'));
  }
  return verify.apply(this,args);
 });
 const plan=await copyPlan(f.workspace.root,f.destination,{vault:f.vault});
 await encryptedCopy(plan,f.access,f.freshVault,f.vault,{afterVerified:()=>{published=true;assert.equal(audits,1);}});
 assert.equal(published,true);assert.equal(audits,1);
 await absent(path.join(f.destination,CATALOGUE_ARCHIVE));await absent(path.join(f.destination,CATALOGUE_ACTIVATION));await absent(path.join(f.destination,'.observanda/copy-in-progress'));
 const reopened=new Workspace(f.destination,f.freshVault);assert.deepEqual(await reopened.read(),f.before);assert.equal(audits,1,'Reopening reuses the verified committed binding');
 assert.deepEqual(await reopened.history(),await f.workspace.history());
 await assert.rejects(new Workspace(f.destination,f.vault).read(),{code:'ENCRYPTION_DAMAGED'});
 await sourceUnchanged(f);
});

test('corruption of the exported fresh-key archive blocks destination publication and preserves the source',async t=>{
 const f=await fixture(t),open=Workspace.prototype.openCatalogue;let corrupted=false,published=false;
 t.mock.method(Workspace.prototype,'openCatalogue',async function(options={}){
  if(this.root===f.destination&&!options.create&&!corrupted){
   const file=path.join(f.destination,CATALOGUE_ARCHIVE),bytes=await readFile(file);assert.ok(bytes.length>1);
   await writeFile(file,bytes.subarray(0,bytes.length-1));corrupted=true;
  }
  return open.call(this,options);
 });
 const plan=await copyPlan(f.workspace.root,f.destination,{vault:f.vault});
 await assert.rejects(encryptedCopy(plan,f.access,f.freshVault,f.vault,{afterVerified:()=>{published=true;}}),{code:'CATALOGUE_DAMAGED'});
 assert.equal(corrupted,true);assert.equal(published,false);await absent(path.join(f.destination,CATALOGUE_FILE));
 await readFile(path.join(f.destination,CATALOGUE_ARCHIVE));await readFile(path.join(f.destination,'.observanda/copy-in-progress'));
 await assert.rejects(new Workspace(f.destination,f.freshVault).read(),{code:'STORAGE_INCOMPLETE'});
 await sourceUnchanged(f);
});

test('standalone rekey still validates before exporting and does not activate its archive',async t=>{
 const f=await fixture(t),descriptorText=await f.workspace.readFile(await workspaceFile(f.workspace.root),'utf8'),descriptor=JSON.parse(descriptorText),verify=ResearchCatalogue.prototype.verify;let audits=0;
 async function target(name){
  const root=path.join(f.directory,name),workspace=new Workspace(root,f.freshVault);await mkdir(path.join(root,'.observanda'),{recursive:true});
  await atomicWrite(path.join(root,'.observanda/access.json'),serialize(f.access));await workspace.writeFile(await workspaceFile(root,{secure:true}),descriptorText);return workspace;
 }
 const valid=await target('standalone'),invalid=await target('invalid');
 t.mock.method(ResearchCatalogue.prototype,'verify',async function(...args){
  if([valid.root,invalid.root].includes(this.workspace.root)){audits++;await absent(path.join(this.workspace.root,CATALOGUE_ARCHIVE));}
  return verify.apply(this,args);
 });
 await rekeyCatalogue(f.workspace,valid,descriptor);assert.equal(audits,1);await readFile(path.join(valid.root,CATALOGUE_ARCHIVE));await absent(path.join(valid.root,CATALOGUE_FILE));
 await assert.rejects(rekeyCatalogue(f.workspace,invalid,{...descriptor,workspaceId:'00000000-0000-4000-8000-000000000001'}),{code:'CATALOGUE_DAMAGED'});
 assert.equal(audits,2);await absent(path.join(invalid.root,CATALOGUE_ARCHIVE));await absent(path.join(invalid.root,CATALOGUE_FILE));
 t.mock.restoreAll();assert.deepEqual(await valid.read(),f.before);await sourceUnchanged(f);
});

test('connected rekey rejects a requested descriptor different from the restored archive before binding publication',async t=>{
 const f=await fixture(t),target=new Workspace(f.destination,f.freshVault),descriptorText=await f.workspace.readFile(await workspaceFile(f.workspace.root),'utf8'),descriptor=JSON.parse(descriptorText);
 await mkdir(path.join(f.destination,'.observanda'),{recursive:true});await atomicWrite(path.join(f.destination,'.observanda/access.json'),serialize(f.access));
 await target.writeFile(await workspaceFile(f.destination,{secure:true}),descriptorText);
 await assert.rejects(rekeyCatalogue(f.workspace,target,{...descriptor,workspaceId:'00000000-0000-4000-8000-000000000001'},{activate:true}),{code:'CATALOGUE_DAMAGED'});
 await absent(path.join(f.destination,CATALOGUE_FILE));await readFile(path.join(f.destination,CATALOGUE_ARCHIVE));await sourceUnchanged(f);
});

for(const point of ['fresh-copy-before-activation-commit','fresh-copy-activation-commit'])test('fresh-key copy resumes after '+point,async t=>{
 const f=await fixture(t),stopped=await interruptWorkspace(f.workspace.root,f.vault,point,{freshCopy:{destination:f.destination,access:f.access,vault:{id:f.freshVault.id,key:f.freshVault.key.toString('base64')}}},{checkpointTimeoutMs:60000});
 const archive=await readFile(path.join(f.destination,CATALOGUE_ARCHIVE)),pending=JSON.parse(await readFile(path.join(f.destination,CATALOGUE_ACTIVATION)));
 assert.equal('obs_'+pending.id.replaceAll('-',''),stopped.schema);await absent(path.join(f.destination,CATALOGUE_FILE));
 await assert.rejects(new Workspace(f.destination,f.freshVault).read(),{code:'STORAGE_INCOMPLETE'});
 const recovery=new WorkspaceCopyRecovery(f.workspace,f.destination,{encryptionAccess:f.access}),plan=await recovery.plan();
 assert.equal((await recovery.read()).phase,'database');assert.equal(plan.encrypted,true);
 const open=Workspace.prototype.openCatalogue,verify=ResearchCatalogue.prototype.verify;let audits=0,creations=0;
 t.mock.method(Workspace.prototype,'openCatalogue',function(options={}){if(this.root===f.destination&&options.create)creations++;return open.call(this,options);});
 t.mock.method(ResearchCatalogue.prototype,'verify',async function(...args){if(this.workspace.root===f.destination){audits++;assert.deepEqual(await readFile(path.join(f.destination,CATALOGUE_ARCHIVE)),archive);}return verify.apply(this,args);});
 await recovery.run(plan,{value:{projects:[]}},()=>encryptedCopy(plan,f.access,f.freshVault,f.vault,{recovery}));
 assert.equal(creations,0,'Resume must not repeat rekeying after the durable archive checkpoint');assert.equal(audits,1);
 const binding=JSON.parse(await readFile(path.join(f.destination,CATALOGUE_FILE)));assert.equal(binding.id,pending.id);
 await absent(path.join(f.destination,CATALOGUE_ARCHIVE));await absent(path.join(f.destination,CATALOGUE_ACTIVATION));await absent(path.join(f.destination,'.observanda/copy-in-progress'));
 assert.deepEqual(await new Workspace(f.destination,f.freshVault).read(),f.before);await sourceUnchanged(f);
});
