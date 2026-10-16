import {RecordValueTree} from '../src/record-value-tree.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {DashboardDiscovery} from '../src/dashboard-discovery.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {validDiscoveryPage} from '../src/web/data-discovery.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {digest,serialize} from '../src/storage-format.js';

async function fixture(t,count){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-discovery-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Study '+i,body:'BODY MUST NOT LEAVE DISCOVERY',sections:[],attachments:[],figures:[],relations:[],contributors:[{id:randomUUID(),name:'Artist '+i,role:'Performer'}]}));
 const f=await encryptedFixture(directory,book),etag=(await f.workspace.read()).etag;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,book,service:new DashboardDiscovery(f.workspace),command:{workspaceId:book.id,etag,provider:'contributors',offset:0,limit:12,search:''}};
}
test('card discovery retains a label-only page and reads no bodies across tenfold record growth',async t=>{
 for(const count of [40,400]){
  const f=await fixture(t,count),read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record;
  ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace loaded');};ResearchCatalogue.prototype.record=()=>{throw Error('Discovery loaded a body');};
  try{
   const first=await f.service.read(f.command),last=await f.service.read({...f.command,offset:count-4});
   assert.ok(validDiscoveryPage(first,f.command));assert.equal(first.total,count);assert.equal(first.items.length,12);assert.equal(last.items.length,4);
   assert.ok(first.items.every(row=>Object.keys(row).sort().join()==='key,subtitle,title'));assert.ok(!JSON.stringify(first).includes('BODY MUST NOT'));
   const target=f.book.entries.at(-1),found=await f.service.read({...f.command,search:target.contributors[0].name});assert.equal(found.items[0].key,target.id+':'+target.contributors[0].id);
   const query=await new RecordQuery(f.workspace).list({workspaceId:f.book.id,query:{projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse()}});
   assert.ok(query.records.every(row=>!Object.hasOwn(row,'cardSources')));
   t.diagnostic(count+' records: label discovery and its search read zero bodies');
  }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
 }
});
test('discovery pins source labels to the snapshot and rejects invalid identities and pages',async t=>{
 const f=await fixture(t,25),original=f.book.entries[0],changed=structuredClone(original);changed.contributors[0].name='Revised credit';
 const saved=await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:changed}]},{recordIds:[original.id]});
 assert.equal((await f.service.read({...f.command,search:'Revised credit'})).total,0);
 assert.equal((await f.service.read({...f.command,etag:saved.etag,search:'Revised credit'})).items[0].key,original.id+':'+original.contributors[0].id);
 for(const change of [{provider:'passwords'},{limit:13},{offset:-1},{search:'x'.repeat(513)}])await assert.rejects(f.service.read({...f.command,...change}),{code:'INVALID'});
 await assert.rejects(f.service.read({...f.command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 const controller=new AbortController();controller.abort();await assert.rejects(f.service.read(f.command,{signal:controller.signal}),{name:'AbortError'});
 const page=await f.service.read(f.command);assert.equal(validDiscoveryPage({...page,items:page.items.slice(1)},f.command),false);
 await f.workspace.catalogue(store=>store.verifySnapshot(saved.etag,f.book.id));
});
test('older summary caches remain readable and verifiable without rewriting their snapshots',async t=>{
 const put=ResearchCatalogue.prototype.putQuery;
 ResearchCatalogue.prototype.putQuery=async function(record,metadata){
  const {queryRevision}=await put.call(this,record,metadata),slot='record-query:'+record.id+':'+queryRevision;
  const value=this.decode('state',slot,(await this.db.get('SELECT payload FROM state WHERE slot=$1',slot)).payload);delete value.cardSources;
  const oldRevision=digest(serialize(value)),oldSlot='record-query:'+record.id+':'+oldRevision;
  await this.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO NOTHING',oldSlot,this.encode('state',oldSlot,value));return {queryRevision:oldRevision};
 };
 let f;try{f=await fixture(t,3);}finally{ResearchCatalogue.prototype.putQuery=put;}
 const page=await f.service.read(f.command);assert.equal(page.total,3);assert.equal((await f.workspace.read()).etag,f.command.etag);
 await f.workspace.catalogue(store=>store.verifySnapshot(f.command.etag,f.book.id));
});

test('nested discovery selects bounded label windows from a large blocked query',async t=>{
 const f=await fixture(t,1),record=f.book.entries[0],count=600;
 const updated={...record,contributors:Array.from({length:count},(_,i)=>({id:randomUUID(),name:'Researcher '+String(i).padStart(4,'0')+' '+('x'.repeat(120)),role:'Observer'}))};
 const saved=await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:updated}]},{recordIds:[record.id]});
 const selected=RecordValueTree.prototype.selected,body=ResearchCatalogue.prototype.record;let labels=0;
 RecordValueTree.prototype.selected=async function(root,path,...args){if(path[0]==='cardSources')throw Error('Discovery materialized a source collection');const result=await selected.call(this,root,path,...args);if(!path.length&&result.value?.key&&result.value?.title)labels++;return result;};
 ResearchCatalogue.prototype.record=()=>{throw Error('Discovery loaded original content');};
 try{
  const command={...f.command,etag:saved.etag},first=await f.service.read(command),last=await f.service.read({...command,offset:count-12});assert.equal(first.total,count);assert.equal(last.total,count);assert.equal(last.items.length,12);assert.ok(labels<=24);assert.equal(last.items.at(-1).key,record.id+':'+updated.contributors.at(-1).id);
  const found=await f.service.read({...command,search:'Researcher 0599'});assert.equal(found.total,1);assert.equal(found.items[0].key,last.items.at(-1).key);
 }finally{RecordValueTree.prototype.selected=selected;ResearchCatalogue.prototype.record=body;}
});
