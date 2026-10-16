import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault,encrypted} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {RecordQuery} from '../src/record-query.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {RecordSearchIndex} from '../src/record-search-index.js';
import {ObjectIndex} from '../src/object-index.js';
import {digest} from '../src/storage-format.js';
import {verifySearchChange} from '../src/record-search-verification.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {queryRecords,recordBrowse} from '../src/web/record-query.js';
const query=(search='',extra={})=>({projectId:null,notebookId:null,filter:'all',search,browse:recordBrowse(),...extra});
async function fixture(t,count=12,body='Ordinary field notes'){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-search-index-')),book=upgradeNotebook(sampleNotebook());
 const seed={...book.entries[0],body,figures:[],attachments:[],sections:[],relations:[],contributors:[],tags:[],type:'note',share:false};
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Study '+i}));
 book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Listening sessions'});
 const {workspace:ws,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 return {directory,book,ws,vault,queries:new RecordQuery(ws),service:new ResearchRecords(ws,{})};
}
const save=(f,base,records)=>f.service.save({workspaceId:f.book.id,baseEtag:base.etag,changes:records.map(record=>({id:record.id,expectedRevision:recordRevision(base.book.entries.find(r=>r.id===record.id)),record}))},{compact:true});
const states=ws=>ws.catalogue(s=>s.db.all("SELECT slot,payload FROM state WHERE starts_with(slot,'record-search-index:') ORDER BY slot"));

test('incremental audits reject missing edits and unrelated forged terms, and verify reordered positions',async t=>{
 const f=await fixture(t,12),base=await f.ws.read(),before=await f.ws.catalogue(store=>store.snapshot());
 await save(f,base,[{...base.book.entries[0],body:'Replacement observation'}]);
 const saved=await f.ws.read(),after=await f.ws.catalogue(store=>store.snapshot());
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  const search=new RecordSearchIndex(store);await search.verify(before);
  assert.equal(await verifySearchChange(store,before,after),true);
  await assert.rejects(verifySearchChange(store,before,{...after,searchIndex:before.searchIndex}),{code:'CATALOGUE_DAMAGED'});
  const key='book:'+f.book.notebooks[0].id+':gram:ffff:0000000000000000',root=await search.change(after.searchIndex.root,key,'1'.padStart(64,'0'));await search.flush(root);
  await assert.rejects(verifySearchChange(store,before,{...after,searchIndex:{...after.searchIndex,root}}),{code:'CATALOGUE_DAMAGED'});
 }));
 const draft=structuredClone(saved.book);draft.entries.reverse();await f.ws.save(draft,saved.etag);
 await f.ws.catalogue(async store=>assert.equal(await verifySearchChange(store,after,await store.snapshot()),true));
});
const list=(f,q,cursor=null,limit=25)=>{const {relatedTo=null,...filters}=q;return f.queries.list({workspaceId:f.book.id,query:filters,relatedTo,cursor,limit});};

test('relationship and prose backlinks only read matching records across tenfold growth',async t=>{
 for(const count of [40,400]){
  const f=await fixture(t,count),base=await f.ws.read(),target=base.book.entries[0],children=base.book.entries.slice(1,4).map(e=>structuredClone(e));
  for(const e of children)e.relations=[{id:randomUUID(),type:'Documents',label:target.title,target:{workspaceId:f.book.id,kind:'record',id:target.id}}];
  children[2].relations=[];children[2].body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Context for this field observation',marks:[{type:'link',attrs:{href:'observanda://'+f.book.id+'/record/'+target.id,title:'',target:'_self',nofollow:false}}]}]}]};
  await save(f,base,children);
  const original={members:ResearchCatalogue.prototype.members,record:ResearchCatalogue.prototype.record,decode:ResearchCatalogue.prototype.decode};let documents=0;
  ResearchCatalogue.prototype.members=()=>{throw Error('Backlinks scanned all membership');};ResearchCatalogue.prototype.record=()=>{throw Error('Backlinks loaded a record body');};
  ResearchCatalogue.prototype.decode=function(table,id,bytes){if(id.startsWith('record-query:')||id.startsWith('record-summary:'))documents++;return original.decode.call(this,table,id,bytes);};
  const q=query('',{relatedTo:{workspaceId:f.book.id,id:target.id}});
  try{
   const result=await list(f,q);assert.equal(result.total,3);assert.equal(documents,3);assert.ok(result.records.some(r=>r.linkedBy.some(l=>l.type==='Mentioned in text')));
   documents=0;assert.equal((await list(f,{...q,search:'Context for this'})).total,1);assert.equal(documents,1);
   documents=0;assert.equal((await list(f,{...q,relatedTo:{workspaceId:f.book.id,id:base.book.entries[5].id}})).total,0);assert.equal(documents,0);
  }finally{for(const [key,method] of Object.entries(original))ResearchCatalogue.prototype[key]=method;}
  t.diagnostic(count+' records: linked history decoded 3 matching documents; text intersection decoded 1.');
  const latest=await f.ws.read(),changed={...latest.book.entries[1],relations:[]};await save(f,latest,[changed]);assert.equal((await list(f,q)).total,2);
 }
});

test('legacy text-only indexes remain valid and never hide new relationships',async t=>{
 const f=await fixture(t),snapshot=await f.ws.catalogue(s=>s.snapshot()),head=await f.ws.catalogue(s=>s.head());
 // This fixture has no links: its postings are also a valid version-one index.
 await f.ws.withLock(()=>f.ws.catalogue(s=>s.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',head,s.encode('snapshot',head,{...snapshot,searchIndex:{...snapshot.searchIndex,version:1}}))));
 const base=await f.ws.read(),target=base.book.entries[0],child=structuredClone(base.book.entries[1]);child.relations=[{id:randomUUID(),type:'Uses',label:target.title,target:{workspaceId:f.book.id,kind:'record',id:target.id}}];
 await save(f,base,[child]);assert.equal((await f.ws.catalogue(s=>s.snapshot())).searchIndex.version,1);
 assert.equal((await list(f,query('',{relatedTo:{workspaceId:f.book.id,id:target.id}}))).total,1);
 await f.ws.catalogue(async s=>s.verifySnapshot(await s.head(),f.book.id));
});

test('indexed substring search reads candidates only across tenfold record growth and bitmap boundaries',async t=>{
 for(const count of [40,400]){
  const f=await fixture(t,count),base=await f.ws.read(),selected=[0,Math.min(255,count-3),Math.min(256,count-2),count-1];
  await save(f,base,selected.map(i=>({...base.book.entries[i],body:'Quartz sensor observations',notebookId:i===count-1?f.book.notebooks.at(-1).id:base.book.entries[i].notebookId})));
  const original={members:ResearchCatalogue.prototype.members,record:ResearchCatalogue.prototype.record,decode:ResearchCatalogue.prototype.decode,read:ResearchCatalogue.prototype.read};
  let documents=0,members=0,nodes=0;
  ResearchCatalogue.prototype.members=()=>{throw Error('Search scanned snapshot membership');};
  ResearchCatalogue.prototype.record=()=>{throw Error('Search read a record body');};
  ResearchCatalogue.prototype.read=()=>{throw Error('Search assembled the workspace');};
  ResearchCatalogue.prototype.decode=function(table,id,bytes){
   if(id.startsWith('record-query:'))documents++;
   if(id.startsWith('record-member:'))members++;
   if(id.startsWith('record-search-index:'))nodes++;
   return original.decode.call(this,table,id,bytes);
  };
  try{
   const result=await list(f,query('QUARTZ'));
   assert.equal(result.total,4);assert.equal(documents,4);assert.equal(members,4);
   assert.ok(nodes<600,'bounded index planning and candidate reads: '+nodes);
   t.diagnostic(count+' records: rare search decoded '+documents+' documents, '+members+' members and '+nodes+' index nodes.');
   documents=members=0;
   assert.equal((await list(f,query('quartz',{notebookId:f.book.notebooks.at(-1).id}))).total,1);
   assert.equal(documents,1);assert.equal(members,1);
   documents=members=0;
   assert.equal((await list(f,query('absent zirconium'))).total,0);
   assert.equal(documents,0);assert.equal(members,0);
  }finally{for(const [key,method] of Object.entries(original))ResearchCatalogue.prototype[key]=method;}
 }
});

test('short, phrase, Unicode and exact numeric searches preserve filters without trusting fragment matches',async t=>{
 const f=await fixture(t),base=await f.ws.read(),entries=structuredClone(base.book.entries);
 entries[0].body='Moss \u00c5ngstr\u00f6m \ud83c\udfb5 recordings; counter 9007199254740993123456789; base-six 105234. Caf\u00e9';
 entries[1].body='abc separator bcd'; // Same trigrams, different phrase.
 entries[2].body='Actual abcd phrase';entries[2].status='incomplete';
 entries[3].body='MOSS from another session';entries[3].notebookId=f.book.notebooks.at(-1).id;
 entries[4].body='Methods and interpretation';entries[4].tags=['BIRD'];
 entries[5].body='A long phrase with unchanged acquisition order and precise original values';
 await save(f,base,entries);
 const current=(await f.ws.read()).book.entries;
 for(const term of ['m','mo','oss','\u00c5NG','\ud83c\udfb5','\udfb5','9007199254740993123456789','105234','caf\u00e9','CAF','abcd','bird','phrase with unchanged acquisition order and precise','','not present']){
  for(const q of [query(term),query(term,{notebookId:f.book.notebooks[0].id}),query(term,{browse:recordBrowse({status:'incomplete',sort:'title'})})]){
   const result=await list(f,q);
   assert.deepEqual(result.records.map(r=>r.id),queryRecords(current,{...q,notebook:q.notebookId??'all'}).map(r=>r.id),JSON.stringify(q));
   assert.ok(result.records.every(r=>!('body' in r)&&!('searchText' in r)));
  }
 }
 assert.deepEqual((await list(f,query('abcd'))).records.map(r=>r.id),[entries[2].id]);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(f.book)));
});

test('saved search pages pin old postings across edits, moves, structural removal and reordering',async t=>{
 const f=await fixture(t,18),base=await f.ws.read();
 await save(f,base,base.book.entries.slice(0,5).map(r=>({...r,body:'Retained quartz method'})));
 const ready=await f.ws.read(),q=query('quartz',{browse:recordBrowse({sort:'title'})}),first=await list(f,q,null,2),before=await states(f.ws);
 await save(f,ready,[{...ready.book.entries[0],body:'Replacement feldspar method',notebookId:f.book.notebooks.at(-1).id}]);
 await save(f,ready,[{...ready.book.entries[1],body:'Different feldspar method'}]);
 const newer=await f.ws.read();newer.book.entries=newer.book.entries.filter(r=>r.id!==ready.book.entries[2].id).reverse();
 await f.ws.save(newer.book,newer.etag);
 assert.equal((await list(f,q)).total,2);assert.equal((await list(f,query('feldspar'))).total,2);
 const second=await list(f,q,first.nextCursor,2),third=await list(f,q,second.nextCursor,2);
 assert.equal(second.changed,true);assert.equal(third.nextCursor,null);assert.equal(third.total,5);
 assert.deepEqual([...first.records,...second.records,...third.records].map(r=>r.id),queryRecords(ready.book.entries,q).map(r=>r.id));
 const after=new Map((await states(f.ws)).map(r=>[r.slot,r.payload]));
 assert.ok(before.every(r=>after.get(r.slot)?.equals(r.payload)),'old encrypted branches remain byte-identical');
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(f.book)));
 const empty=await f.ws.read();empty.book.entries=[];await f.ws.save(empty.book,empty.etag);
 assert.equal((await list(f,q)).total,0);assert.equal((await f.ws.catalogue(s=>s.snapshot())).searchIndex.root,null);
 assert.equal((await list(f,q,first.nextCursor,2)).total,5);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(f.book)));
});

test('failed indexing rolls back; ordinary and fresh-key restore preserve searchable revision identities',async t=>{
 const f=await fixture(t,8),base=await f.ws.read(),before=await states(f.ws),remember=ResearchCatalogue.prototype.rememberHistory;
 ResearchCatalogue.prototype.rememberHistory=()=>{throw Object.assign(Error('Interrupted after search index'),{code:'ENOSPC'});};
 try{await assert.rejects(save(f,base,[{...base.book.entries[0],body:'Uncommitted zirconium'}]),{code:'ENOSPC'});}
 finally{ResearchCatalogue.prototype.rememberHistory=remember;}
 assert.deepEqual(await states(f.ws),before);assert.equal((await f.ws.read()).etag,base.etag);
 assert.equal((await list(f,query('zirconium'))).total,0);
 await save(f,base,[{...base.book.entries[0],body:'Verified zirconium 105234'}]);
 const q=query('field'),first=await list(f,q,null,2);
 const copy=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'backup')),{vault:f.vault}),restored=new RecordQuery(new Workspace(copy,f.vault));
 assert.deepEqual((await restored.list({workspaceId:f.book.id,query:q,cursor:first.nextCursor,limit:2})).records,(await list(f,q,first.nextCursor,2)).records);
 const access=await createAccess('','synthetic portable search key'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const target=await encryptedCopy(await copyPlan(f.ws.root,path.join(f.directory,'fresh-key')),access,vault,f.vault),newWorkspace=new Workspace(target,vault),newQuery=new RecordQuery(newWorkspace);
 assert.equal((await newQuery.list({workspaceId:f.book.id,query:query('zirconium')})).records[0].id,base.book.entries[0].id);
 assert.deepEqual(await newWorkspace.catalogue(s=>s.read(base.etag)),base);
 for(const row of await states(f.ws)){assert.ok(encrypted(Buffer.from(row.payload)));assert.ok(!row.payload.includes(Buffer.from('zirconium')));assert.match(row.slot,/^record-search-index:[a-f0-9]{64}$/);}
 clearVault(f.vault);await assert.rejects(list(f,q),{code:'ACCESS_LOCKED'});
});

test('missing branches fail closed, verification rejects incomplete postings, and cancelled queries release reads',async t=>{
 const f=await fixture(t),snapshot=await f.ws.catalogue(s=>s.snapshot()),head=await f.ws.catalogue(s=>s.head()),slot='record-search-index:'+snapshot.searchIndex.root.hash;
 const stored=await f.ws.catalogue(s=>s.db.get('SELECT payload FROM state WHERE slot=$1',slot));
 await f.ws.withLock(()=>f.ws.catalogue(s=>s.db.run('DELETE FROM state WHERE slot=$1',slot)));
 await assert.rejects(list(f,query('field')),{code:'CATALOGUE_DAMAGED'});
 await f.ws.withLock(()=>f.ws.catalogue(s=>s.db.run('INSERT INTO state VALUES ($1,$2)',slot,stored.payload)));
 await f.ws.withLock(()=>f.ws.catalogue(async s=>{
  const index=new RecordSearchIndex(s),first=(await index.entries({root:snapshot.searchIndex.root},'book:').next()).value;
  const root=await index.change(snapshot.searchIndex.root,first.id,null);await index.flush(root);
  await s.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',head,s.encode('snapshot',head,{...snapshot,searchIndex:{version:1,root}}));
 }));
 await assert.rejects(f.ws.catalogue(s=>s.verify(catalogueDescriptor(f.book))),{code:'CATALOGUE_DAMAGED'});
 await f.ws.withLock(()=>f.ws.catalogue(s=>s.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',head,s.encode('snapshot',head,snapshot))));
 const controller=new AbortController(),original=RecordSearchIndex.prototype.rank;let calls=0;
 RecordSearchIndex.prototype.rank=async function(...args){if(++calls===2)controller.abort();return original.apply(this,args);};
 try{await assert.rejects(f.queries.list({workspaceId:f.book.id,query:query('field')},{signal:controller.signal}),{name:'AbortError'});}
 finally{RecordSearchIndex.prototype.rank=original;}
 assert.equal((await list(f,query('field'))).total,12);
 const {searchIndex,...legacy}=snapshot;
 await f.ws.withLock(()=>f.ws.catalogue(s=>s.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',head,s.encode('snapshot',head,legacy))));
 assert.equal((await list(f,query('field'))).total,12);
 const base=await f.ws.read();await save(f,base,[{...base.book.entries[0],body:'New searchable sound'}]);
 assert.ok((await f.ws.catalogue(s=>s.snapshot())).searchIndex);
 assert.equal((await f.ws.catalogue(s=>s.snapshot(head))).searchIndex,undefined);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(f.book)));
});

test('pre-summary members use retained record ownership when their next save creates a search index',async t=>{
 const f=await fixture(t,5),base=await f.ws.read();
 await f.ws.withLock(()=>f.ws.catalogue(async s=>{
  const manifest=await s.manifest(base.etag);
  manifest.records=manifest.records.map(({notebookId,queryRevision,summaryRevision,...row})=>row);
  await s.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',base.etag,s.encode('snapshot',base.etag,manifest));
 }));
 assert.equal((await list(f,query('field'))).total,5);
 await save(f,base,[{...base.book.entries[0],body:'Listening to birds',notebookId:f.book.notebooks.at(-1).id}]);
 assert.equal((await list(f,query('field'))).total,4);
 assert.equal((await list(f,query('field',{notebookId:f.book.notebooks.at(-1).id}))).total,0);
 assert.equal((await list(f,query('birds',{notebookId:f.book.notebooks.at(-1).id}))).total,1);
 const next=await f.ws.read();await save(f,next,[{...next.book.entries[1],body:'Second listening session'}]);
 assert.equal((await list(f,query('field'))).total,3);
});

test('streamed verification rejects extra posting bits, zero words and extra positions',async t=>{
 const f=await fixture(t,3);
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  const snapshot=await store.snapshot(),index=new RecordSearchIndex(store),head={root:snapshot.searchIndex.root};
  const word=(await index.entries(head,'book:').next()).value;
  for(const [id,value] of [
   [word.id,(BigInt('0x'+word.revision)|(1n<<240n)).toString(16).padStart(64,'0')],
   [word.id,'0'.repeat(64)],
   ['position:0000000000000999','1'.repeat(64)]
  ]){
   const root=await index.change(head.root,id,value);await index.flush(root);
   await assert.rejects(index.verify({...snapshot,searchIndex:{version:1,root}}),{code:'CATALOGUE_DAMAGED'});
  }
  await index.verify(snapshot);
 }));
});

test('verification batches repeated long descriptions instead of re-reading every word for every record',async t=>{
 const body=Array.from({length:150},(_,i)=>'sensor-'+i+' observation-'+i*i+'; ').join('');
 const f=await fixture(t,100,body);
 await f.ws.catalogue(async store=>{
  const snapshot=await store.snapshot(),index=new RecordSearchIndex(store),find=index.find;let reads=0;
  index.find=async function(...args){reads++;return find.apply(this,args);};
  await index.verify(snapshot);
  assert.ok(reads<4000,'verification point-read budget: '+reads);
  t.diagnostic('100 repeated long descriptions: '+reads+' verification point reads.');
 });
});


test('full search construction combines a shared scientific vocabulary before editing index branches',async t=>{
 const text=Array.from({length:512},(_,i)=>digest(String(i)).slice(0,12)).join(' '),f=await fixture(t,64,text);
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  const snapshot=await store.snapshot(),find=ObjectIndex.prototype.find;let inputWords=0;
  ObjectIndex.prototype.find=async function(...args){if(this.nodeStorage&&!this.immutable&&this.namespace==='object-index:')inputWords++;return find.apply(this,args);};
  let built;try{built=await new RecordSearchIndex(store).build(snapshot);}finally{ObjectIndex.prototype.find=find;}
  assert.ok(built.root.count>2048&&built.root.count<32768);
  assert.equal(inputWords,built.root.count,'repeated bitmap words are combined across records');
  await new RecordSearchIndex(store).verify({...snapshot,searchIndex:built});
  assert.equal(built.root.count,snapshot.searchIndex.root.count);
  t.diagnostic(JSON.stringify({records:snapshot.count,uniqueWords:built.root.count,treeInputs:inputWords}));
 }));
});
