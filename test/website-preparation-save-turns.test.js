import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {sampleNotebook} from '../src/sample.js';
import {executeResearchRequest} from '../src/research-requests.js';
import {PublicationConversion} from '../src/publication-conversion.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {upgradeExistingWebsites} from '../src/website-files-migration.js';

// Preparing saved websites seeds each shared entry as a website source. A record save
// fences the same source. The two take turns on the owner's producer lease: neither
// fails, the library holds each entry once with the saved content and no fence is left.
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-preparation-save-')),book=sampleNotebook(),example=book.entries[1],notebook=book.notebooks[0];
 book.entries=Array.from({length:3},(_,i)=>({...structuredClone(example),id:randomUUID(),title:'Entry '+i,notebookId:notebook.id,share:true,
  sections:[{id:randomUUID(),title:'Later method '+i,body:'Released later '+i,share:false}]}));
 // An authored home composition makes the default site one that preparation converts.
 book.website.home.sections.unshift({id:'authored-heading',kind:'text',show:true,title:'Authored home design',body:'Authored website introduction'});
 const {workspace,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
 const store=new WebsiteFileStore(workspace),record=book.entries[0],section=record.sections[0],identity={workspaceId:book.id,recordId:record.id,sectionId:section.id};
 const sourceId=websiteSourceId({workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,recordId:record.id});
 return {book,workspace,store,record,section,identity,sourceId};
}
// Shares the entry's withheld section: a permission change, so the save rewrites its source.
async function saveData(f){
 const current=await executeResearchRequest(f.workspace,'/api/research/records/writing/read',f.identity);
 return {...f.identity,expectedRevision:current.revision,value:{...current.value,share:true}};
}
const gate=()=>{let open,arrive;const opened=new Promise(resolve=>{open=resolve;}),reached=new Promise(resolve=>{arrive=resolve;});return {open,reached,pass:()=>{arrive();return opened;}};};
// Fails at once, instead of waiting for the timeout, when the work ends before its hold.
const until=(reached,work,label)=>Promise.race([reached,work.result.then(outcome=>assert.fail(label+' ended before its hold: '+(outcome.error?.stack??JSON.stringify(outcome.value))))]);
const observe=promise=>{const state={settled:false};state.result=promise.then(value=>{state.settled=true;return {value};},error=>{state.settled=true;return {error};});return state;};
async function settled(f,result){
 assert.equal(result.state,'ready',JSON.stringify(result));assert.equal(result.done,result.total);
 const library=await f.store.library({limit:100});
 assert.deepEqual(library.items.map(row=>row.title).sort(),f.book.entries.map(entry=>entry.title).sort());
 assert.deepEqual([...await f.store.scope(()=>f.store.pendingSources())],[]);
 const root=path.join(f.workspace.root,'.observanda','website-files');
 for(const id of await readdir(path.join(root,'sources')))assert.deepEqual((await readdir(path.join(root,'sources',id))).filter(name=>name==='pending.json'),[],id);
 const source=await f.store.getSource(f.sourceId);
 assert.match(source.html,/Released later 0/);assert.doesNotMatch(source.html,/Released later [12]/);
 const manifest=await f.store.scope(()=>f.store.raw(result.defaultSiteId));
 assert.equal(manifest.sources.find(item=>item.id===f.sourceId)?.revision,source.revision);
 return f.store.open(result.defaultSiteId,{path:'entries/'+f.record.id+'.html'});
}

test('a record save during website preparation waits for the seeded pages to be imported',{timeout:600000},async t=>{
 const f=await fixture(t),hold=gate(),seedSources=PublicationConversion.prototype.seedSources;let held=false;
 // Hold the seed after it has fenced its sources, under the lease, before its snapshot.
 PublicationConversion.prototype.seedSources=function(provenances,withOwner,options){
  const owner=held?withOwner:consume=>withOwner(async(...args)=>{await hold.pass();return consume(...args);});held=true;
  return seedSources.call(this,provenances,owner,options);
 };
 t.after(()=>{PublicationConversion.prototype.seedSources=seedSources;});
 const preparation=observe(upgradeExistingWebsites(f.workspace));
 await until(hold.reached,preparation,'preparation');
 assert.ok((await f.store.scope(()=>f.store.pendingSources())).has(f.sourceId),'the seed fenced the entry');
 const save=observe(executeResearchRequest(f.workspace,'/api/research/records/writing/save',await saveData(f),{publicationConversion:new PublicationConversion(f.workspace)}));
 await delay(1000);
 assert.equal(save.settled,false,'the save waits for the seed instead of replacing its fence');
 hold.open();
 const prepared=await preparation.result;assert.equal(prepared.error,undefined,prepared.error?.stack);
 const saved=await save.result;assert.equal(saved.error,undefined,saved.error?.stack);
 // The save ran after the import, so it also refreshed the imported entry page.
 const page=await settled(f,prepared.value);assert.match(page.html,/Released later 0/);
});

test('website preparation waits for a record save that already fenced a seeded entry',{timeout:600000},async t=>{
 const f=await fixture(t),hold=gate(),saving=gate(),seedWebsites=PublicationConversion.prototype.seedWebsites;let held=false;
 // Hold preparation just before it seeds, after its saved edition is captured.
 PublicationConversion.prototype.seedWebsites=async function(...args){if(!held){held=true;await hold.pass();}return seedWebsites.apply(this,args);};
 t.after(()=>{PublicationConversion.prototype.seedWebsites=seedWebsites;});
 const preparation=observe(upgradeExistingWebsites(f.workspace));
 await until(hold.reached,preparation,'preparation');
 const data=await saveData(f),conversion=new PublicationConversion(f.workspace);
 // The save holds its fence while its research write is held.
 const save=observe(conversion.mutate(f.workspace,{route:'/api/research/records/writing/save',data},async()=>{await saving.pass();return executeResearchRequest(f.workspace,'/api/research/records/writing/save',data);}));
 await until(saving.reached,save,'the save');
 assert.ok((await f.store.scope(()=>f.store.pendingSources())).has(f.sourceId),'the save fenced the entry');
 hold.open();
 await delay(1000);
 assert.equal(preparation.settled,false,'preparation waits for the save instead of failing on its fence');
 saving.open();
 const saved=await save.result;assert.equal(saved.error,undefined,saved.error?.stack);
 const prepared=await preparation.result;assert.equal(prepared.error,undefined,prepared.error?.stack);
 await settled(f,prepared.value);
});
