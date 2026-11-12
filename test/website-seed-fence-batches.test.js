import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {seedEligibleWebsiteOwner} from '../src/website-library-discovery.js';

// Seeding shares one fence-list write and one library generation change per group. An
// interruption at each new boundary must leave a state that the next run completes, with
// every entry present once, no fence left behind and no journal left open.
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-seed-fences-'));
 const book=sampleNotebook(),notebook=book.notebooks[0],example=book.entries[1];
 book.entries=Array.from({length:37},(_,i)=>({...example,id:randomUUID(),title:'Entry '+i,notebookId:notebook.id,share:true,sections:[{id:randomUUID(),title:'Withheld',body:'PRIVATE-CANARY',share:false}]}));
 const {workspace,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
 const store=new WebsiteFileStore(workspace),reader={async use(namespace,_revision,consume){
  assert.equal(namespace,book.id);
  return {value:await workspace.catalogue(async catalogue=>{const snapshotId=await catalogue.head();return consume(catalogue,await catalogue.snapshot(snapshotId),{snapshotId,storage:workspace});})};
 }};
 return {book,workspace,store,reader};
}
async function settled(f){
 const library=await f.store.library({limit:100});
 assert.deepEqual(library.items.map(row=>row.title).sort(),f.book.entries.map(entry=>entry.title).sort());
 assert.deepEqual([...await f.store.scope(()=>f.store.pendingSources())],[]);
 const root=path.join(f.workspace.root,'.observanda','website-files');
 const scopes=await readdir(path.join(root,'pending-scopes')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 assert.deepEqual(scopes,[]);
 for(const id of await readdir(path.join(root,'sources')))assert.deepEqual((await readdir(path.join(root,'sources',id))).filter(name=>name==='pending.json'),[],id);
 const site=await f.store.create({name:'Fence proof'}),source=library.items[0];
 const placed=await f.store.insertSource(site.site.id,{expectedRevision:site.site.revision,sourceId:source.id});
 assert.doesNotMatch(placed.html,/PRIVATE-CANARY/);
}
// The interruption is a stopped process: after it, no write or removal of website storage
// happens, so no cleanup can tidy the state the next run must recover from.
const interruption=(store,{write,remove})=>{
 const writeControl=store.writeControl,removeFile=store.remove,writeBytes=store.writeBytes;let fired=false;
 store.writeControl=async function(name,value,options){if(fired||write?.(name,value)){fired=true;throw Error('Interrupted at '+name);}return writeControl.call(this,name,value,options);};
 store.writeBytes=async function(name,...rest){if(fired)throw Error('Interrupted at '+name);return writeBytes.call(this,name,...rest);};
 store.remove=async function(name){if(fired||remove?.(name)){fired=true;throw Error('Interrupted removing '+name);}return removeFile.call(this,name);};
 return ()=>{store.writeControl=writeControl;store.remove=removeFile;store.writeBytes=writeBytes;return fired;};
};
let counter=0;const after=n=>{counter=0;return ()=>++counter===n;};
for(const [label,points] of [
 ['between source journals and the shared fence list',()=>{const nth=after(20);return {write:name=>name.includes('/pending-scopes/')&&nth()};}],
 ['at the shared fence list of the opened group',()=>({write:(name,value)=>name.endsWith('website-files/pending.json')&&Array.isArray(value)&&value.length>16})],
 ['while saving a group before its fence list',()=>{const nth=after(20);return {write:name=>/\/sources\/[a-f0-9]{64}\/head\.json$/.test(name)&&nth()};}],
 ['at the fence list written after a saved group',()=>{let saving=false;return {write:(name,value)=>{if(name.endsWith('/head.json'))saving=true;return saving&&name.endsWith('website-files/pending.json');}};}],
 ['between the fence list and the journal removals',()=>({remove:name=>/\/sources\/[a-f0-9]{64}\/pending\.json$/.test(name)})],
 ['at the library generation change after a group',()=>{let indexed=0;return {write:name=>{if(name.includes('/picker/')&&!name.endsWith('generation.json'))indexed++;return indexed>3&&name.endsWith('picker/generation.json');}};}]
])test('seeding resumes correctly after an interruption '+label,{timeout:600000},async t=>{
 const f=await fixture(t),restore=interruption(f.store,points());
 await assert.rejects(seedEligibleWebsiteOwner(f.store,f.reader,f.book.id),/Interrupted/);
 assert.equal(restore(),true,'the interruption point was reached');
 await seedEligibleWebsiteOwner(f.store,f.reader,f.book.id);
 await settled(f);
});
