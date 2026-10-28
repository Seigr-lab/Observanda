import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {WebsiteDocumentBlockStore,withWebsiteDocumentReads} from '../src/website-document-block-store.js';
import {CatalogueReadCache} from '../src/catalogue-read-cache.js';
import {RecordDocument} from '../src/record-document.js';
import {websiteDocumentHeader} from '../src/website-document-validation.js';
import {retainRecordContainer} from '../src/record-tree-values.js';
import {serialize} from '../src/storage-format.js';

function fixture(){
 const rows=new Map(),counts={queries:0,decodes:0},store={readCache:new CatalogueReadCache(),
  encode:(_table,slot,value)=>Buffer.from(serialize({slot,value})),
  decode:(_table,slot,payload)=>{counts.decodes++;const row=JSON.parse(payload);assert.equal(row.slot,slot);return row.value;},
  db:{get:async(_sql,slot)=>{counts.queries++;return rows.has(slot)?{payload:rows.get(slot)}:null;},
   all:async(_sql,slots)=>{counts.queries++;return slots.filter(slot=>rows.has(slot)).map(slot=>({slot,payload:rows.get(slot)}));},
   run:async(sql,...values)=>{assert.match(sql,/^INSERT INTO state/);counts.queries++;for(let i=0;i<values.length;i+=2)rows.set(values[i],values[i+1]);}}
 };return {store,rows,counts};
}

test('writer block caches are owned by one operation and cleared on success or failure',async()=>{
 const store={},failure=Error('Transaction failed');let owned;
 const result=await withWebsiteDocumentReads(store,async()=>{
  owned=store.websiteBlockCache;owned.replace('immutable-block',Buffer.from('ciphertext'));
  await withWebsiteDocumentReads(store,async()=>{assert.equal(store.websiteBlockCache,owned);});
  assert.equal(owned.rows.size,1);return 'committed';
 });
 assert.equal(result,'committed');assert.equal(store.websiteBlockCache,undefined);assert.equal(owned.rows.size,0);assert.equal(owned.bytes,0);
 await assert.rejects(withWebsiteDocumentReads(store,async()=>{owned=store.websiteBlockCache;owned.replace('immutable-block',Buffer.from('ciphertext'));throw failure;}),error=>error===failure);
 assert.equal(store.websiteBlockCache,undefined);assert.equal(owned.rows.size,0);assert.equal(owned.bytes,0);
 const reader=new CatalogueReadCache();reader.replace('snapshot-block',Buffer.from('ciphertext'));store.readCache=reader;
 await withWebsiteDocumentReads(store,async()=>{assert.equal(store.readCache,reader);assert.equal(store.websiteBlockCache,undefined);});
 assert.equal(reader.rows.size,1,'A nested operation does not clear its caller-owned read snapshot');
});
test('website headers reuse one bounded immutable projection without sharing mutable caller values',async()=>{
 const f=fixture(),blocks=new WebsiteDocumentBlockStore(f.store,randomUUID()),site={id:randomUUID(),projectId:null,document:{website:{title:'Before',home:{sections:Array.from({length:40},(_,i)=>({title:'Section '+i,body:'Exact '.repeat(400)}))},assets:[{private:'Omitted asset'}],navigation:[],layouts:[],researchSources:[]},pages:[{private:'Omitted page'}],branding:[]}};
 const root=await blocks.tree().retain(site);await blocks.flush();const document=new RecordDocument(blocks,root,{mutable:true}),first=await websiteDocumentHeader(document),queries=f.counts.queries;
 first.document.website.title='Caller mutation';first.document.website.home.sections.length=0;
 const again=await websiteDocumentHeader(document);assert.equal(again.document.website.title,'Before');assert.equal(again.document.website.home.sections.length,40);assert.deepEqual(again.document.pages,[]);assert.deepEqual(again.document.website.assets,[]);assert.equal(f.counts.queries,queries);
 const changed=await document.replace(['document','website','title'],'After');assert.equal((await websiteDocumentHeader(changed)).document.website.title,'After');assert.equal((await websiteDocumentHeader(document)).document.website.title,'Before');
 const controller=new AbortController();controller.abort(Error('Stop header'));await assert.rejects(websiteDocumentHeader(document,{signal:controller.signal}),/Stop header/);
 // A fresh owner must authenticate storage again after the transaction closes.
 f.store.readCache.clear();f.rows.set(blocks.slot('value',root),Buffer.from('corrupt'));
 await assert.rejects(websiteDocumentHeader(new RecordDocument(new WebsiteDocumentBlockStore(f.store,blocks.websiteId),root)));
});
test('header traversal rejects duplicate properties and does not retain oversized projections',async()=>{
 const f=fixture(),blocks=new WebsiteDocumentBlockStore(f.store,randomUUID()),value=await blocks.tree().retain(null),root=await retainRecordContainer(blocks,'object',[{name:'projectId',value},{name:'projectId',value}]);await blocks.flush();
 await assert.rejects(websiteDocumentHeader(new RecordDocument(blocks,root)),{code:'CATALOGUE_DAMAGED'});
 const large=await blocks.tree().retain({document:{website:{description:'x'.repeat(300000),assets:[],layouts:[],navigation:[]},pages:[],branding:[]}});await blocks.flush();
 const document=new RecordDocument(blocks,large);await websiteDocumentHeader(document);let reads=0;const select=document.tree.select.bind(document.tree);document.tree.select=async(...args)=>{reads++;return select(...args);};await websiteDocumentHeader(document);assert.ok(reads>0,'Oversized headers must not be cached');
});
test('shared ciphertext avoids repeated reads but reauthenticates each website and each fresh owner',async()=>{
 const f=fixture(),id=randomUUID(),writer=new WebsiteDocumentBlockStore(f.store,id),revision=await writer.put('value',{type:'inline',value:'Private website value'});await writer.flush();
 const first=new WebsiteDocumentBlockStore(f.store,id);await first.read('value',revision);const before={...f.counts};
 const next=new WebsiteDocumentBlockStore(f.store,id);await next.prefetch('value',[revision]);assert.equal((await next.read('value',revision)).value,'Private website value');assert.equal(f.counts.queries,before.queries);assert.equal(f.counts.decodes,before.decodes+1);
 const other=new WebsiteDocumentBlockStore(f.store,randomUUID());f.store.readCache.replace(other.slot('value',revision),f.rows.get(writer.slot('value',revision)));await assert.rejects(other.read('value',revision));
 f.store.readCache.clear();f.rows.set(writer.slot('value',revision),f.store.encode('state',writer.slot('value',revision),{type:'inline',value:'Changed stored value'}));await assert.rejects(new WebsiteDocumentBlockStore(f.store,id).read('value',revision),{code:'CATALOGUE_DAMAGED'});
 assert.ok(f.store.readCache.rows.size<=128);assert.ok(f.store.readCache.bytes<=256*1024);
});
