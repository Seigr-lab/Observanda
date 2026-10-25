import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cachedMaterialText,rememberMaterialText} from '../src/catalogue-material-text-cache.js';
import {CatalogueReadCache} from '../src/catalogue-read-cache.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ObjectIndex} from '../src/object-index.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {catalogueContext} from '../src/catalogue-context.js';
import {withMetadataBatch,metadataBatchIndex} from '../src/metadata-batch.js';
import {withDatabaseRequest} from '../src/database-request-context.js';
import {digest,serialize} from '../src/storage-format.js';
import {AppError} from '../src/errors.js';

const hash=value=>digest(serialize(value));
const sequenceId=(value,kind='chunks')=>'metadata:.observanda/materials/sequences/'+kind+'/'+hash(value)+'.json';
function fixture(options){
 const rows=new Map(),cache=new CatalogueReadCache(options),workspace={root:'synthetic-material-reader',vault:{id:'synthetic-vault',key:Buffer.alloc(32,7)}};
 let reads=0,decodes=0;
 const db={async get(sql,id){assert.equal(sql,'SELECT payload FROM objects WHERE id=$1');reads++;return rows.has(id)?{payload:Buffer.from(rows.get(id))}:undefined;}};
 const store=new ResearchCatalogue(workspace,db,{readCache:cache}),decode=store.decode;
 store.decode=function(...args){decodes++;return decode.apply(this,args);};
 function add(value,id=sequenceId(JSON.parse(value.text))){rows.set(id,store.encode('object',id,value));return {id,revision:hash(value)};}
 // Exercise the objectValue admission order with an injected ownership resolver:
 // reject absence, try reuse, decode/resolve/hash, then retain the LOCAL envelope.
 async function read({id,revision},resolve=async value=>value){
  const batch=metadataBatchIndex(store),load=()=>db.get('SELECT payload FROM objects WHERE id=$1',id),row=batch?await batch.objectRow(id):await store.readCache.row('object:'+id,load);
  if(!row)throw new AppError('CATALOGUE_DAMAGED');
  const cached=cachedMaterialText(store,id,revision);if(cached)return cached;
  const decoded=store.decode('object',id,row.payload),value=await resolve(decoded);
  if(hash(value)!==revision)throw new AppError('CATALOGUE_DAMAGED');
  rememberMaterialText(store,id,revision,decoded);return value;
 }
 const local=(text='Synthetic acquired detail. '.repeat(165))=>({text:serialize({kind:'cell-text',offset:0,items:[text]})});
 return {rows,cache,workspace,store,add,read,local,get reads(){return reads;},get decodes(){return decodes;}};
}

test('repeated encrypted local sequence text decodes once and returns independent envelopes',async t=>{
 const f=fixture(),value=f.local(),entry=f.add(value);
 for(let i=0;i<50;i++){const returned=await f.read(entry);assert.deepEqual(returned,value);returned.text='caller mutation';returned.extra=true;}
 assert.equal(f.reads,1);assert.equal(f.decodes,1);
 assert.deepEqual(await f.read(entry),value);assert.ok(Object.isFrozen(f.cache.node('object:'+entry.id)));
 t.diagnostic(JSON.stringify({repeatedTextReads:51,encryptedRowReads:f.reads,textDecodes:f.decodes}));
});

test('the catalogue object reader integrates local reuse without masking missing rows or wrong revisions',async()=>{
 const f=fixture(),value=f.local(),entry=f.add(value);
 for(let i=0;i<25;i++){
  const result=await f.store.objectValue(entry.id,entry);assert.deepEqual(result,value);result.text='caller edit';
 }
 assert.equal(f.reads,1);assert.equal(f.decodes,1);
 await assert.rejects(f.store.objectValue(entry.id,{...entry,revision:'0'.repeat(64)}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.store.objectValue(entry.id,null),{code:'CATALOGUE_DAMAGED'});
 f.cache.clear();f.rows.delete(entry.id);
 await assert.rejects(f.store.objectValue(entry.id,entry),{code:'CATALOGUE_DAMAGED'});
 assert.equal(await f.store.objectValue(entry.id,null),null);
});

test('forged cache values and changed expected revisions never supply authenticated text',async()=>{
 const f=fixture(),value=f.local(),entry=f.add(value);await f.read(entry);
 f.cache.keepNode('object:'+entry.id,Object.freeze({text:'forged'}),128);
 assert.deepEqual(await f.read(entry),value);assert.equal(f.decodes,2);
 await assert.rejects(f.read({...entry,revision:'0'.repeat(64)}),{code:'CATALOGUE_DAMAGED'});
 assert.deepEqual(await f.read(entry),value);assert.equal(f.decodes,3);
 const uncached=fixture(),wrong=uncached.add(uncached.local());wrong.revision='0'.repeat(64);
 await assert.rejects(uncached.read(wrong),{code:'CATALOGUE_DAMAGED'});assert.equal(uncached.cache.nodes.size,0);
});

test('encryption key, AAD, root, owner and database identity changes require authentication again',async()=>{
 const f=fixture(),entry=f.add(f.local()),originalKey=Buffer.from(f.workspace.vault.key);await f.read(entry);
 f.workspace.vault.key[0]^=1;await assert.rejects(f.read(entry),{code:'ENCRYPTION_DAMAGED'});
 f.workspace.vault.key=Buffer.from(originalKey);await f.read(entry);
 f.workspace.vault.id='other-vault';await assert.rejects(f.read(entry),{code:'ENCRYPTION_DAMAGED'});f.workspace.vault.id='synthetic-vault';
 f.workspace.vault.key=null;await assert.rejects(f.read(entry),{code:'ACCESS_LOCKED'});f.workspace.vault.key=Buffer.from(originalKey);
 const originalAad=f.store.aad;f.store.aad=function(...args){return originalAad.apply(this,args)+'/other';};
 await assert.rejects(f.read(entry),{code:'ENCRYPTION_DAMAGED'});f.store.aad=originalAad;
 for(const [field,value] of [['root','different-reader'],['projectId','different-project'],['labBookId','different-lab-book']]){
  const before=f.decodes;f.workspace[field]=value;assert.deepEqual(await f.read(entry),f.local());assert.equal(f.decodes,before+1,field);
 }
 const before=f.decodes;f.store.db={...f.store.db};await f.read(entry);assert.equal(f.decodes,before+1);
 originalKey.fill(0);
});

test('ciphertext replacement, eviction, absence and new snapshot do not revive cached text',async()=>{
 for(const boundary of ['replace','evict','missing','snapshot']){
  const f=fixture({maxRows:1}),entry=f.add(f.local());await f.read(entry);
  if(boundary==='missing')f.rows.delete(entry.id);else f.rows.set(entry.id,Buffer.from('damaged ciphertext'));
  if(boundary==='replace')f.cache.replace('object:'+entry.id,f.rows.get(entry.id));
  else if(boundary==='snapshot'){f.cache.clear();f.store.readCache=new CatalogueReadCache();}
  else await f.cache.row('other',async()=>({payload:Buffer.from('other')}));
  await assert.rejects(f.read(entry),{code:boundary==='missing'?'CATALOGUE_DAMAGED':'ENCRYPTION_DAMAGED'},boundary);
 }
 const f=fixture(),entry=f.add(f.local());await f.read(entry);const frozen=f.cache.node('object:'+entry.id);
 f.cache.clear();f.cache.replace('object:'+entry.id,f.rows.get(entry.id));f.cache.keepNode('object:'+entry.id,frozen,100);
 await f.read(entry);assert.equal(f.decodes,2,'Clearing prepared-key identity also invalidates a manually restored old receipt');
 const next=new CatalogueReadCache();next.replace('object:'+entry.id,f.rows.get(entry.id));next.keepNode('object:'+entry.id,f.cache.node('object:'+entry.id),100);f.store.readCache=next;
 await f.read(entry);assert.equal(f.decodes,3,'A different reader cache cannot borrow the receipt');
});

test('writer and metadata-batch scopes neither reuse nor admit reader text',async()=>{
 const f=fixture(),entry=f.add(f.local());await f.read(entry);const before=f.decodes;
 await catalogueContext.run({db:f.store.db},async()=>{await f.read(entry);await f.read(entry);});assert.equal(f.decodes,before+2);
 await withMetadataBatch(f.store,async()=>{await f.read(entry);f.cache.clear();await f.read(entry);assert.equal(f.cache.nodes.size,0);});
 assert.equal(f.decodes,before+4);
 await catalogueContext.run({db:f.store.db},async()=>{await f.read(entry);assert.equal(f.cache.nodes.size,0);});
});

test('retired and retained locations are resolved each time and never cached as local envelopes',async()=>{
 for(const format of ['observanda-retired-metadata','observanda-owned-metadata']){
  const f=fixture(),value=f.local(),id=sequenceId(JSON.parse(value.text)),revision=hash(value),location={format,version:1,revision};
  f.add(location,id);let resolutions=0;
  const resolve=async decoded=>{assert.deepEqual(decoded,location);resolutions++;return value;};
  assert.deepEqual(await f.read({id,revision},resolve),value);assert.deepEqual(await f.read({id,revision},resolve),value);
  assert.equal(resolutions,2);assert.equal(f.decodes,2);assert.equal(f.cache.nodes.size,0);
  await assert.rejects(f.read({id,revision},async()=>{throw new AppError('ACCESS_LOCKED');}),{code:'ACCESS_LOCKED'});
 }
});

test('only exact local sequence text envelopes are eligible; other material and record paths stay uncached',async()=>{
 const f=fixture(),value=f.local(),validId=sequenceId(JSON.parse(value.text));
 for(const id of [validId.replace('/chunks/','/nodes/'),validId]){const entry=f.add(value,id);await f.read(entry);await f.read(entry);assert.ok(f.cache.node('object:'+id));}
 for(const id of ['metadata:.observanda/materials/tables/'+hash(value)+'.json',validId.replace('/chunks/','/numerical-work-values/'),validId.replace('/chunks/','/other/'),validId.replace(/[a-f0-9]{64}\.json$/,'invalid.json'),'metadata:.observanda/record.json']){
  const entry=f.add(value,id),before=f.decodes;await f.read(entry);await f.read(entry);assert.equal(f.decodes,before+2);assert.equal(f.cache.node('object:'+id),null);
 }
 for(const other of [{text:value.text,extra:true},[value.text],{text:null},{nested:{text:value.text}}]){
  const entry=f.add(other,validId);f.cache.replace('object:'+validId,f.rows.get(validId));const before=f.decodes;
  await f.read(entry);await f.read(entry);assert.equal(f.decodes,before+2);assert.equal(f.cache.node('object:'+validId),null);
 }
});

test('text and authenticated index nodes share the same bounded mixed working set',async()=>{
 for(const options of [undefined,{maxRows:4,maxBytes:16*1024},{maxRows:128,maxBytes:8*1024}]){
  const f=fixture(options),index=new ObjectIndex(f.store,{cacheReads:true}),ref=index.make('branch',hash({text:'indexed'})),branch=index.pending.get(ref.hash);
  index.cacheNode(ref,branch);assert.equal(f.cache.node(index.slot(ref)),branch);
  const entries=[],count=options?12:160;
  for(let i=0;i<count;i++){
   const value=f.local(String(i)+':'+String.fromCodePoint(0x1f331).repeat(500)),entry=f.add(value);entries.push({entry,value});await f.read(entry);
   assert.ok(f.cache.nodes.size<=f.cache.maxRows);assert.ok(f.cache.nodeBytes<=f.cache.maxBytes);assert.ok(f.cache.bytes<=f.cache.maxBytes);
  }
  assert.equal(f.decodes,count,'Unique envelopes still require every initial decode');
  assert.equal(f.cache.node(index.slot(ref)),null,'Unique text consumes the shared budget and can evict an index branch');
  index.cacheNode(ref,branch);assert.equal(await index.node(ref),branch);assert.ok(f.cache.nodes.size<=f.cache.maxRows);assert.ok(f.cache.nodeBytes<=f.cache.maxBytes);
  const before=f.decodes;assert.deepEqual(await f.read(entries[0].entry),entries[0].value);assert.equal(f.decodes,before+1);
  const bytes=f.cache.nodeBytes;await f.read(entries[0].entry);assert.equal(f.cache.nodeBytes,bytes,'A hit does not count retained text twice');
 }
});

test('cached envelopes still pass through downstream sequence content-hash and text-size checks',async()=>{
 const f=fixture(),value=f.local(),entry=f.add(value),expected=new Map([[entry.id,entry]]);
 const sequence=new MaterialSequence({async readMetadata(relative,limit){const item=expected.get('metadata:'+relative);assert.ok(item);const {text}=await f.read(item);if(Buffer.byteLength(text)>limit)throw new AppError('LIMIT');return text;}});
 const id=hash(JSON.parse(value.text));assert.deepEqual(await sequence.read('chunks',id),JSON.parse(value.text));
 await assert.rejects(sequence.read('chunks',id,1),{code:'LIMIT'});assert.equal(f.decodes,1);
 const badId='f'.repeat(64),bad=f.add(value,'metadata:.observanda/materials/sequences/chunks/'+badId+'.json');expected.set(bad.id,bad);
 await assert.rejects(sequence.read('chunks',badId),{code:'MATERIAL_MISSING'});
 await assert.rejects(sequence.read('chunks',badId),{code:'MATERIAL_MISSING'});assert.equal(f.decodes,2);
});

test('small-entry and UTF-16 byte limits retain no oversized text or identity',async()=>{
 for(const setup of [f=>f.local('x'.repeat(8192)),f=>f.local(String.fromCodePoint(0x1f331).repeat(4096)),f=>{f.workspace.root='r'.repeat(8192);return f.local('small');}]){
  const f=fixture(),entry=f.add(setup(f));await f.read(entry);await f.read(entry);assert.equal(f.decodes,2);assert.equal(f.cache.nodes.size,0);
 }
 const f=fixture({maxBytes:512}),entry=f.add(f.local('small'));await f.read(entry);await f.read(entry);assert.equal(f.decodes,2);assert.equal(f.cache.nodes.size,0);
});

test('request cancellation rejects both cache hits and misses without admitting text',async()=>{
 const f=fixture(),entry=f.add(f.local());await f.read(entry);const before=f.decodes,controller=new AbortController(),reason=new Error('cancelled text read');controller.abort(reason);
 await withDatabaseRequest(controller.signal,()=>assert.rejects(f.read(entry),error=>error===reason));assert.equal(f.decodes,before);
 f.cache.clear();await withDatabaseRequest(controller.signal,()=>assert.rejects(f.read(entry),error=>error===reason));assert.equal(f.decodes,before);assert.equal(f.cache.nodes.size,0);
 const other=fixture(),next=other.add(other.local()),late=new AbortController();
 await withDatabaseRequest(late.signal,()=>assert.rejects(other.read(next,async value=>{late.abort(reason);return value;}),error=>error===reason));assert.equal(other.cache.nodes.size,0);
});
