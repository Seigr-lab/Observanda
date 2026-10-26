import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {catalogueFormat,catalogueRequiresDomains,catalogueRequiresSettings,requireRecordResultIndexes,requireRecordBlocks,requireWorkspaceDomains,requireProjectDomains,requireWorkspaceSettings} from '../src/catalogue-format.js';
import {readProjectDomainRegistry} from '../src/project-domain-registry.js';
import {workspaceSettingsRegistry} from '../src/workspace-settings.js';
function catalogue(version){
 return {version,retiredIndex:version>=23,
  async all(sql){assert.match(sql,/^SELECT version FROM catalogue_format(?: FOR UPDATE NOWAIT)?$/);return [{version:this.version}];},
  async get(sql){assert.ok(sql.startsWith('SELECT pg_catalog.format_type'));return null;},
  async run(sql,...args){
   if(/^(?:SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT) catalogue_feature_admission$/.test(sql))return;
   if(sql.startsWith('CREATE INDEX records_scope_revision')){assert.equal(this.retiredIndex,false,'The existing index was recreated');this.retiredIndex=true;}
   else if(sql.startsWith('UPDATE catalogue_format'))this.version=Math.max(this.version,args[0]);
   else assert.ok(sql.startsWith('ALTER TABLE catalogue_format'));
  }
 };
}
function ownerStore(version,{projectId=null,domains=null,settings=null}={}){
 const namespaceId=randomUUID(),db=catalogue(version);
 db.get=async(_sql,slot)=>{const value=slot==='project-domains'?domains:settings;return value?{payload:value}:null;};
 return {db,workspace:{projectId},async snapshot(){return {metadata:{id:namespaceId}};},decode(_kind,_slot,value){return value;},namespaceId};
}

test('result storage upgrades preserve required owners and retain the shared scope index',async()=>{
 for(const [before,after] of [[3,26],[14,26],[21,26],[22,27],[23,26],[24,27],[25,28],[26,26],[27,27],[28,28]]){
  const db=catalogue(before),domains=catalogueRequiresDomains(before),settings=catalogueRequiresSettings(before);
  await requireRecordResultIndexes(db);assert.equal(await catalogueFormat(db),after);assert.equal(db.retiredIndex,true);
  assert.equal(catalogueRequiresDomains(after),domains);assert.equal(catalogueRequiresSettings(after),settings);
  await requireRecordResultIndexes(db);await requireRecordBlocks(db);assert.equal(await catalogueFormat(db),after,'Repeated or older feature admission changed capabilities');
 }
 for(const admit of [requireProjectDomains,requireWorkspaceDomains]){
  const db=catalogue(26);await admit(db);assert.equal(db.version,27);assert.equal(catalogueRequiresDomains(db.version),true);assert.equal(catalogueRequiresSettings(db.version),false);
  await requireWorkspaceSettings(db);assert.equal(db.version,28);await admit(db);assert.equal(db.version,28);
 }
 const plain=catalogue(26);await requireWorkspaceSettings(plain);assert.equal(plain.version,28);
});

test('missing domain and settings owners remain errors after result index admission',async()=>{
 for(const format of [24,25,27,28])await assert.rejects(readProjectDomainRegistry(ownerStore(format)),{code:'CATALOGUE_DAMAGED'});
 for(const format of [25,28])await assert.rejects(workspaceSettingsRegistry(ownerStore(format)),{code:'CATALOGUE_DAMAGED'});
 for(const format of [3,23,26])assert.equal(await readProjectDomainRegistry(ownerStore(format)),null);
 for(const format of [3,23,24,26,27])assert.equal(await workspaceSettingsRegistry(ownerStore(format)),null);
 for(const format of [23,26,27])await assert.rejects(readProjectDomainRegistry(ownerStore(format,{projectId:randomUUID()})),{code:'CATALOGUE_DAMAGED'});
 // Optional capabilities do not permit an undeclared settings owner to hide
 // inside a plain result-index catalogue.
 for(const format of [26,27])await assert.rejects(workspaceSettingsRegistry(ownerStore(format,{settings:{version:1}})),{code:'CATALOGUE_DAMAGED'});
 const domain=ownerStore(27);domain.db.get=async()=>({payload:{version:2,projectId:null,namespaceId:domain.namespaceId,domains:['calculator']}});assert.equal((await readProjectDomainRegistry(domain)).namespaceId,domain.namespaceId);
 const settings=ownerStore(28);settings.db.get=async()=>({payload:{version:1,namespaceId:settings.namespaceId,features:['dashboard']}});assert.equal((await workspaceSettingsRegistry(settings)).namespaceId,settings.namespaceId);
});
