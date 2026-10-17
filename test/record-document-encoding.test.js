import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {RecordDocument,withRecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordBlockStore} from '../src/record-block-store.js';
import {recordEncoding,recordContentRevision} from '../src/record-encoding.js';
import {withRecordEncodingAudit} from '../src/record-document-encoding.js';
import {withCatalogueVerification} from '../src/catalogue-verification.js';
import {retainedRecordDisplay} from '../src/record-history-display.js';
import {historicalRecordValue,recordRevision} from '../src/research.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {legacyRecords} from './legacy-records.js';
import {seal} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';

function receipts(){
 const values=new Map();return {values,async get(key){return structuredClone(values.get(key));},async put(key,value){values.set(key,structuredClone(value));},async remove(key){return values.delete(key);}};
}
async function fixture(value={id:randomUUID(),notebookId:randomUUID(),title:'Original',body:'Exact text'}){
 const rows=new Map(),state=new Map(),secret=randomBytes(32),workspace={root:'memory-record-audit',vault:{id:randomUUID(),key:randomBytes(32)}};
 const db={async get(sql,...args){
  if(sql==='SHOW transaction_isolation')return {transaction_isolation:'read committed'};
  if(sql.startsWith('SELECT scope_id,generation,payload FROM records'))return rows.get(args.join(':'));
  if(sql==='SELECT payload FROM state WHERE slot=$1')return state.has(args[0])?{payload:state.get(args[0])}:undefined;
  assert.fail(sql);
 },async all(sql,...args){
  if(sql==='SELECT version FROM catalogue_format')return [{version:49}];
  if(sql.startsWith('SELECT slot,payload FROM state WHERE slot=ANY'))return args[0].filter(slot=>state.has(slot)).map(slot=>({slot,payload:state.get(slot)}));
  assert.fail(sql);
 }};
 const store={workspace,db,readCache:null,aad:(table,id)=>workspace.vault.id+'/'+table+'/'+id,recordAAD:(id,revision,scope,generation)=>workspace.vault.id+'/'+id+'/'+revision+'/'+scope+'/'+generation,scopeKey:async()=>Buffer.from(secret),decode:(_table,_id,payload)=>JSON.parse(payload.toString())};
 async function add(record,{generation=1,version=1,inline=false,revision=recordEncoding(record).revision}={}){
  const nodes=new Map(),memory={async put(kind,node){const hash=digest(serialize(node));nodes.set(kind+':'+hash,node);return hash;},async read(kind,hash){return structuredClone(nodes.get(kind+':'+hash));}};
  const tree=new RecordValueTree(memory),root=await tree.retain(record),blocks=new RecordBlockStore(store,record.notebookId,generation,secret);
  for(const [name,node] of nodes){const [kind,hash]=name.split(':'),slot=blocks.slot(kind,hash);state.set(slot,Buffer.from(serialize(blocks.encode(slot,node))));}
  const manifest=inline?record:{format:'observanda-record-blocks',version,id:record.id,notebookId:record.notebookId,root};
  rows.set(record.id+':'+revision,{scope_id:record.notebookId,generation,payload:seal(Buffer.from(serialize(manifest)),secret,store.recordAAD(record.id,revision,record.notebookId,generation))});
  return {record,root,revision,open:(consume,options)=>withRecordDocument(store,record.id,revision,consume,options),slot:blocks.slot('value',root)};
 }
 return {store,state,rows,add,...await add(value)};
}
function traversals(t,roots){
 const calls=[],json=RecordValueTree.prototype.json;
 t.mock.method(RecordValueTree.prototype,'json',async function*(root,options={}){if((options.depth??0)===0&&roots.has(root))calls.push({root,canonical:options.canonical===true});yield* json.call(this,root,options);});return calls;
}
const expected=value=>({...recordEncoding(value),contentRevision:recordContentRevision(value)});

test('audit encodings keep exact identities and reuse each distinct storage spelling only within the audit',async t=>{
 const value={id:randomUUID(),notebookId:randomUUID(),'10':'ten','2':'two',body:'Line\n\ud800 \ud83d\udd2c '.repeat(4000),title:'Exact'},f=await fixture(value),other=await f.add(Object.fromEntries(Object.entries(value).reverse())),proof=receipts(),calls=traversals(t,new Set([f.root,other.root]));
 assert.notEqual(f.revision,other.revision);assert.equal(recordContentRevision(f.record),recordContentRevision(other.record));
 await withRecordEncodingAudit(f.store,proof,async()=>{
  for(let i=0;i<40;i++)for(const source of [f,other])await source.open(async document=>{const encoded=await document.encoding();assert.deepEqual(encoded,expected(source.record));encoded.contentRevision='changed caller result';});
 });
 assert.equal(calls.length,4);assert.equal(proof.values.size,2);
 await withRecordEncodingAudit(f.store,receipts(),()=>f.open(document=>document.encoding()));assert.equal(calls.length,6);
 await f.open(document=>document.encoding());assert.equal(calls.length,8);
});

test('encoding provenance expires with its callback and excludes mutable, derived and inline legacy documents',async t=>{
 const f=await fixture(),proof=receipts(),calls=traversals(t,new Set([f.root]));let escaped;
 await withRecordEncodingAudit(f.store,proof,async()=>{
  await f.open(async document=>{escaped=document;await document.encoding();await document.encoding();});assert.equal(calls.length,2);
  await escaped.encoding();assert.equal(calls.length,4);
  await f.open(async document=>{await document.encoding();await document.encoding();const derived=new RecordDocument(document.blocks,document.root);await derived.encoding();},{mutable:true});assert.equal(calls.length,10);
  await f.add(f.record,{inline:true});await f.open(async document=>{await document.encoding();await document.encoding();});assert.equal(calls.length,14);
 });
 assert.equal(proof.values.size,1);
});

test('detached asynchronous work cannot reuse a closed audit or ended document callback',async t=>{
 const f=await fixture(),calls=traversals(t,new Set([f.root]));let release,late;
 const pending=new Promise(resolve=>{release=resolve;});
 await withRecordEncodingAudit(f.store,receipts(),()=>f.open(async document=>{
  await document.encoding();late=pending.then(()=>document.encoding());
 }));
 assert.equal(calls.length,2);release();assert.deepEqual(await late,expected(f.record));assert.equal(calls.length,4);
});
test('shared wrappers reuse only the same namespace, database, cache, scope and generation',async t=>{
 const f=await fixture(),proof=receipts(),calls=traversals(t,new Set([f.root]));
 await withRecordEncodingAudit(f.store,proof,async()=>{
  await f.open(document=>document.encoding());
  await withRecordDocument({...f.store},f.record.id,f.revision,document=>document.encoding());assert.equal(calls.length,2);
  for(const store of [{...f.store,db:{...f.store.db}},{...f.store,readCache:undefined},{...f.store,workspace:{...f.store.workspace}}])await withRecordDocument(store,f.record.id,f.revision,document=>document.encoding());assert.equal(calls.length,8);
  await f.open(async document=>{
   const db=f.store.db;f.store.db={...db};await document.encoding();f.store.db=db;
   const cache=f.store.readCache;f.store.readCache=undefined;await document.encoding();f.store.readCache=cache;
   await document.encoding();
  });assert.equal(calls.length,12);
  await f.add(f.record,{generation:2});await f.open(document=>document.encoding());assert.equal(calls.length,14);assert.equal(proof.values.size,2);
 });
});

test('READ COMMITTED never enters an encoding audit and changed document roots do not inherit receipts',async t=>{
 const f=await fixture(),proof=receipts(),calls=traversals(t,new Set([f.root]));
 await withCatalogueVerification(f.store,async verification=>{assert.equal(verification.stableSnapshot,undefined);await f.open(async document=>{await document.encoding();await document.encoding();});});assert.equal(calls.length,4);
 await withRecordEncodingAudit(f.store,proof,()=>f.open(async document=>{
  await document.encoding();const root=document.root;document.root=await document.tree.retain({...f.record,title:'Different original'});
  assert.equal((await document.encoding()).contentRevision,recordContentRevision({...f.record,title:'Different original'}));document.root=root;
  await document.encoding();assert.equal(calls.length,6);
 }));assert.equal(proof.values.size,1);
});

test('cancelled pending receipts, cached reads and failed traversals never suppress a later check',async t=>{
 const f=await fixture(),proof=receipts(),calls=traversals(t,new Set([f.root])),stop=Error('Stop encoding'),controller=new AbortController(),put=proof.put;let cancelled=false;
 proof.put=async function(...args){await put.apply(this,args);if(!cancelled){cancelled=true;controller.abort(stop);}};
 await withRecordEncodingAudit(f.store,proof,async()=>{
  await assert.rejects(f.open(document=>document.encoding({signal:controller.signal})),error=>error===stop);assert.equal(proof.values.size,0);
  await f.open(document=>document.encoding());assert.equal(calls.length,4);
  await assert.rejects(f.open(document=>document.encoding({signal:controller.signal})),error=>error===stop);assert.equal(calls.length,4);
 });
 const afterRead=new AbortController(),cached=receipts();
 await withRecordEncodingAudit(f.store,cached,async()=>{
  await f.open(document=>document.encoding());const get=cached.get,before=calls.length;
  cached.get=async function(key){const value=await get.call(this,key);afterRead.abort(stop);return value;};
  await assert.rejects(f.open(document=>document.encoding({signal:afterRead.signal})),error=>error===stop);assert.equal(calls.length,before);
 });
 const broken=receipts(),json=RecordValueTree.prototype.json;let fail=true;
 const spy=t.mock.method(RecordValueTree.prototype,'json',async function*(root,options){yield* json.call(this,root,options);if(fail&&options?.canonical){fail=false;throw Error('Interrupted canonical traversal');}});
 try{await withRecordEncodingAudit(f.store,broken,async()=>{await assert.rejects(f.open(document=>document.encoding()),/Interrupted canonical/);assert.equal(broken.values.size,0);await f.open(document=>document.encoding());assert.equal(broken.values.size,1);});}finally{spy.mock.restore();}
});

test('new audits reject corrupted blocks and authenticated envelopes with a false storage revision',async()=>{
 const f=await fixture();await withRecordEncodingAudit(f.store,receipts(),()=>f.open(document=>document.encoding()));
 const bytes=Buffer.from(f.state.get(f.slot)),original=Buffer.from(bytes),parsed=JSON.parse(bytes.toString()),encrypted=Buffer.from(parsed.content,'base64');encrypted[encrypted.length-1]^=1;parsed.content=encrypted.toString('base64');f.state.set(f.slot,Buffer.from(serialize(parsed)));
 await assert.rejects(withRecordEncodingAudit(f.store,receipts(),()=>f.open(document=>document.encoding())),{code:'ENCRYPTION_DAMAGED'});f.state.set(f.slot,original);
 const bad=await f.add(f.record,{revision:'0'.repeat(64)}),proof=receipts();await assert.rejects(withRecordEncodingAudit(f.store,proof,()=>bad.open(document=>document.encoding())),{code:'CATALOGUE_DAMAGED'});assert.equal(proof.values.size,0);
});

test('legacy historical display transformations keep their independently upgraded identity',async()=>{
 const book=legacyRecords(upgradeNotebook(sampleNotebook()));book.formatVersion=12;const record=book.entries[0],metadata={...book,entries:[]},f=await fixture(record),proof=receipts();f.store.record=async()=>structuredClone(record);
 const display=historicalRecordValue(metadata,record);assert.notEqual(recordRevision(record),recordRevision(display));
 await withRecordEncodingAudit(f.store,proof,async()=>{
  await f.open(async document=>assert.equal((await document.encoding()).contentRevision,recordRevision(record)));
  const retained=await retainedRecordDisplay(f.store,record.id,f.revision,metadata);assert.equal(retained.revision,recordRevision(display));assert.equal(proof.values.size,1);
 });
});
