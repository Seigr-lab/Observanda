import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {ConfigurationCommands} from '../src/configuration-commands.js';
import {laboratoryProfiles,enableProfile,profileById,upgradeProfile} from '../src/web/laboratory/catalog.js';

// Books that adopted an older version of each profile that has newer ones.
const upgradable=laboratoryProfiles.filter(p=>p.version>1);

async function fixture(t,configuration){
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-profile-upgrade-')),book=upgradeNotebook(sampleNotebook());
 const notebook=book.notebooks[0];notebook.configuration=configuration;
 const f=await encryptedFixture(directory,book);t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const commands=new ConfigurationCommands(f.workspace),owner={workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'};
 return {commands,owner,opened:await commands.open(owner)};
}
const rows=async(commands,base,draft,collection,selectors={})=>{const out=[];for(let offset=0;;){const page=await commands.window({...base,draftId:draft.id,draftRevision:draft.revision,collection,...selectors,offset,limit:32});out.push(...page.rows);if(page.next===null)return out;offset=page.next;}};

test('the configuration service upgrades a book exactly like the lab book editor',{timeout:240000},async t=>{
 const configuration={profiles:[],sections:[]};
 for(const profile of laboratoryProfiles)enableProfile(configuration,profile.id,true);
 // Rebuild each upgradable profile as version 1 copied it.
 for(const profile of upgradable){
  configuration.profiles.find(p=>p.id===profile.id).version=1;
  configuration.sections=configuration.sections.filter(s=>s.profileId!==profile.id||profile.introduced.sections[s.key]===1);
  for(const s of configuration.sections.filter(s=>s.profileId===profile.id)){
   s.fields=s.fields.filter(f=>profile.introduced.fields[s.key+'/'+f.key]===1);
   for(const f of s.fields)if((profile.introduced.private[s.key+'/'+f.key]??1)>1)delete f.private;
   for(const f of s.fields)f.choices=f.choices.filter(c=>profile.introduced.choices[s.key+'/'+f.key+'/'+c]===1);
  }
 }
 const expected=structuredClone(configuration);for(const profile of upgradable)upgradeProfile(expected,profile.id);
 const {commands,owner,opened}=await fixture(t,configuration),base={...owner,configurationPin:opened.configurationPin};
 await assert.rejects(commands.change({...base,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'profile-upgrade',key:'unknown-profile'}]}),{code:'INVALID'});
 await assert.rejects(commands.change({...base,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'profile-upgrade',key:upgradable[0]?.id??'beekeeping',extra:true}]}),{code:'INVALID'});
 const operations=[...upgradable.map(p=>({type:'profile-upgrade',key:p.id})),{type:'profile-upgrade',key:'beekeeping'}];
 const changed=await commands.change({...base,draftId:null,expectedRevision:null,commandId:randomUUID(),operations});
 const profiles=await rows(commands,base,changed.draft,'profiles');
 assert.deepEqual(profiles.map(r=>[r.value.id,r.value.version]).sort(),expected.profiles.map(p=>[p.id,p.version]).sort());
 const sections=await rows(commands,base,changed.draft,'sections');
 assert.deepEqual(sections.map(r=>(r.value.profileId??'')+':'+r.value.key),expected.sections.map(s=>(s.profileId??'')+':'+s.key));
 for(const row of sections){
  const want=expected.sections.find(s=>s.profileId===row.value.profileId&&s.key===row.value.key),fields=await rows(commands,base,changed.draft,'fields',{sectionId:row.key});
  assert.deepEqual(fields.map(f=>[f.key,f.value.private===true]),want.fields.map(f=>[f.key,f.private===true]),row.value.key);
  for(const field of fields.filter(f=>f.value.type==='select'))assert.deepEqual((await rows(commands,base,changed.draft,'choices',{sectionId:row.key,fieldKey:field.key})).map(c=>c.value),want.fields.find(f=>f.key===field.key).choices);
 }
 assert.ok(profileById('beekeeping'));
});
