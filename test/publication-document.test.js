import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PublicationDocumentBuilder,PublicationDocument,publicationDocumentPrefix,publicationDocumentBlockName,isPublicationDocumentBlockName,isPublicationDocumentBlockPath} from '../src/publication-document.js';
import {digest,serialize} from '../src/storage-format.js';
import {PublicationDocumentBlocks} from '../src/publication-document-blocks.js';
function memory(websiteId=null){
 const files=new Map(),reads=[],writes=[];
 return {websiteId,files,reads,writes,async readMetadata(file,limit){reads.push(file);const text=files.get(file)??null;if(text!==null)assert.ok(Buffer.byteLength(text)<=limit);return text;},async writeMetadata(file,text){assert.equal(files.has(file),false,'immutable nodes are never rewritten');assert.ok(Buffer.byteLength(text)<=65536);files.set(file,text);writes.push(file);}};
}
const owner=(kind='source',websiteId=null)=>({kind,workspaceId:randomUUID(),websiteId,jobId:randomUUID(),attemptId:kind==='output'?randomUUID():null});
const schema={records:{indexes:['scopeDate','original']},files:{indexes:[]}};
async function build(workspace,scope,rows,collections=schema){const builder=new PublicationDocumentBuilder(workspace,{owner:scope,collections});for(const row of rows)await builder.append('records',row.id,row,{indexes:{scopeDate:'book/'+row.date,original:row.id}});return {builder,descriptor:await builder.finish({header:{version:6,title:'Exact retained source'}})};}

test('publication collections exceed the former envelope while selected reads remain bounded',async()=>{
 const workspace=memory(),scope=owner(),builder=new PublicationDocumentBuilder(workspace,{owner:scope,collections:schema});let bytes=0,last;
 for(let i=0;i<128;i++){const value={id:'record-'+i,date:String(i).padStart(3,'0'),body:randomBytes(105*1024).toString('base64')};bytes+=Buffer.byteLength(JSON.stringify(value));await builder.append('records',value.id,value,{indexes:{scopeDate:'book/'+value.date,original:value.id}});last=value;}
 assert.ok(bytes>16*1024*1024);assert.equal(builder.count('records'),128);assert.ok(builder.blocks.cacheBytes<=1024*1024);assert.ok(builder.index.cacheBytes<=4*1024*1024);
 const descriptor=await builder.finish({header:{version:6,title:'Large source'}});assert.ok(Buffer.byteLength(serialize(descriptor))<1024);assert.ok([...workspace.files.values()].every(text=>Buffer.byteLength(text)<=65536));
 workspace.reads.length=0;const reader=await PublicationDocument.open(workspace,descriptor,{owner:scope});assert.deepEqual(await reader.get('records',last.id),last);assert.ok(workspace.reads.length<65,'one record uses bounded index paths and only its value chunks');
 workspace.reads.length=0;const page=await reader.window('records',{offset:126,limit:2});assert.equal(page.total,128);assert.deepEqual(page.items.map(item=>item.key),['record-126','record-127']);assert.ok(workspace.reads.length<65);assert.equal(page.next,null);
 assert.deepEqual(await reader.verify(),{collections:2,items:128});
});

test('builder lookups, upserts and scoped windows preserve insertion order independently of sort order',async()=>{
 const workspace=memory(),scope=owner(),builder=new PublicationDocumentBuilder(workspace,{owner:scope,collections:schema});
 for(const [id,date] of [['c','003'],['a','001'],['b','002']])await builder.append('records',id,{id,date},{indexes:{scopeDate:'book/'+date,original:id}});
 assert.deepEqual(await builder.get('records','a'),{id:'a',date:'001'});assert.equal(await builder.get('records','absent'),null);await assert.rejects(builder.append('records','a',{}),{code:'PUBLICATION_IDENTITY'});
 const prior=await builder.window('records',{index:'scopeDate',prefix:'book/',limit:1});assert.equal(prior.items[0].key,'a');
 await builder.upsert('records','a',{id:'a',date:'004',excerpt:'Changed'},{indexes:{scopeDate:'other/004'}});
 assert.equal(builder.count('records'),3);assert.equal(await builder.has('records','a'),true);assert.equal(await builder.has('records','missing'),false);
 assert.equal(await builder.position('records','a'),1);assert.equal(await builder.position('records','c',{index:'scopeDate',prefix:'book/'}),1);assert.equal(await builder.position('records','c',{index:'scopeDate',prefix:'book/',reverse:true}),0);assert.equal(await builder.position('records','a',{index:'scopeDate',prefix:'book/'}),null);assert.equal(await builder.position('records','a',{index:'original'}),null);assert.equal(await builder.position('records','absent'),null);await assert.rejects(builder.window('records',{index:'scopeDate',prefix:'book/',cursor:prior.next}),{code:'INVALID'});
 assert.deepEqual((await builder.window('records',{index:'scopeDate',prefix:'book/',reverse:true})).items.map(item=>item.key),['c','b']);
 assert.deepEqual((await builder.window('records',{index:'original'})).items.map(item=>item.key),['b','c']);
 assert.deepEqual((await builder.window('records')).items.map(item=>item.key),['c','a','b']);
 const first=await builder.window('records',{limit:1}),rest=await builder.window('records',{cursor:first.next,limit:2});assert.deepEqual(rest.items.map(item=>item.key),['a','b']);
 const descriptor=await builder.finish();await assert.rejects(builder.upsert('records','a',{}),{code:'INVALID'});const reader=await PublicationDocument.open(workspace,descriptor);assert.equal((await reader.get('records','a')).excerpt,'Changed');assert.deepEqual(await reader.verify(),{collections:2,items:3});
});

test('owner, cursor, attempt and exact cleanup names are isolated',async()=>{
 const websiteId=randomUUID(),workspace=memory(websiteId),scope=owner('source',websiteId),{descriptor}=await build(workspace,scope,[{id:'a',date:'001'},{id:'b',date:'002'}]),reader=await PublicationDocument.open(workspace,descriptor),page=await reader.window('records',{limit:1});
 await assert.rejects(reader.window('files',{cursor:page.next}),{code:'INVALID'});await assert.rejects(reader.window('records',{cursor:page.next,reverse:true}),{code:'INVALID'});await assert.rejects(reader.window('records',{cursor:page.next,index:'key'}),{code:'INVALID'});
 await assert.rejects(PublicationDocument.open(memory(),descriptor),{code:'JOB_DAMAGED'});await assert.rejects(PublicationDocument.open(workspace,descriptor,{owner:{...scope,workspaceId:randomUUID()}}),{code:'JOB_DAMAGED'});
 const adopted={...workspace,websiteId:null};assert.deepEqual(await (await PublicationDocument.open(adopted,descriptor,{owner:scope})).header(),{version:6,title:'Exact retained source'});
 const output=owner('output',websiteId),other=await build(workspace,output,[{id:'a',date:'001'}]);const outputReader=await PublicationDocument.open(workspace,other.descriptor);await assert.rejects(outputReader.window('records',{cursor:page.next}),{code:'INVALID'});
 assert.ok(publicationDocumentPrefix(output).endsWith(output.jobId+'/'+output.attemptId));
 for(const file of workspace.files.keys())assert.ok(isPublicationDocumentBlockPath(scope,file)||isPublicationDocumentBlockPath(output,file));
 const good=publicationDocumentBlockName('value','a'.repeat(64));assert.ok(isPublicationDocumentBlockName(good));for(const bad of ['../'+good,good+'/extra','pd-v-'+randomUUID()+'.json',good.toUpperCase()])assert.equal(isPublicationDocumentBlockName(bad),false);
 assert.throws(()=>publicationDocumentPrefix({...scope,jobId:'../escape'}),{code:'INVALID'});assert.throws(()=>new PublicationDocumentBuilder(workspace,{owner:{...scope,attemptId:randomUUID()},collections:schema}),{code:'INVALID'});
 const otherOwner={...scope,jobId:randomUUID()};for(const [file,text] of [...workspace.files])if(isPublicationDocumentBlockPath(scope,file))workspace.files.set(file.replace(publicationDocumentPrefix(scope),publicationDocumentPrefix(otherOwner)),text);
 await assert.rejects(PublicationDocument.open(workspace,{...descriptor,owner:otherOwner}),{code:'JOB_DAMAGED'});
});

test('authenticated blocks and descriptor counts reject corruption, including after cached reads',async()=>{
 const workspace=memory(),scope=owner(),{descriptor}=await build(workspace,scope,[{id:'a',date:'001',body:'Exact original'}]),reader=await PublicationDocument.open(workspace,descriptor);await reader.get('records','a');
 const target=[...workspace.files].find(([,text])=>text.includes('Exact original'));assert.ok(target);workspace.files.set(target[0],target[1].replace('Exact original','Wrong original'));
 await assert.rejects(reader.verify(),{code:'JOB_DAMAGED'});await assert.rejects((await PublicationDocument.open(workspace,descriptor)).get('records','a'),{code:'JOB_DAMAGED'});workspace.files.set(...target);
 const modified={...descriptor,extra:true};await assert.rejects(PublicationDocument.open(workspace,modified),{code:'JOB_DAMAGED'});
 const bad=structuredClone(descriptor);bad.root='0'.repeat(64);await assert.rejects(PublicationDocument.open(workspace,bad),{code:'JOB_DAMAGED'});
 // Hash-valid nodes with forged collection counts must still fail semantics.
 const builder=new PublicationDocumentBuilder(workspace,{owner:{...scope,jobId:randomUUID()},collections:schema});await builder.append('records','a',{id:'a'});builder.collections.records.count=2;const forged=await builder.finish();await assert.rejects(PublicationDocument.open(workspace,forged),{code:'JOB_DAMAGED'});
 assert.deepEqual(await (await PublicationDocument.open(workspace,descriptor)).verify(),{collections:2,items:1});
});

test('cancellation leaves no published descriptor and input mutations cannot change admitted values',async()=>{
 const workspace=memory(),scope=owner(),controller=new AbortController(),builder=new PublicationDocumentBuilder(workspace,{owner:scope,collections:schema,signal:controller.signal}),value={id:'a',nested:{text:'Admitted'}};
 const write=workspace.writeMetadata;let mutated=false;workspace.writeMetadata=async(file,text)=>{if(!mutated){mutated=true;value.nested.text='Changed by caller';}return write(file,text);};
 await builder.append('records','a',value);assert.equal((await builder.get('records','a')).nested.text,'Admitted');
 controller.abort();const writes=workspace.writes.length;await assert.rejects(builder.finish(),{name:'AbortError'});assert.equal(workspace.writes.length,writes);assert.equal(builder.finished,false);
 const second=memory(),aborting=new AbortController();second.writeMetadata=async(file,text)=>{second.files.set(file,text);aborting.abort();};const interrupted=new PublicationDocumentBuilder(second,{owner:owner(),collections:schema,signal:aborting.signal});await assert.rejects(interrupted.append('records','a',{id:'a'}),{name:'AbortError'});assert.equal(interrupted.count('records'),0);assert.equal(interrupted.finished,false);
 const ordinary=memory(),built=await build(ordinary,owner(),[{id:'a',date:'001'}]);const readAbort=new AbortController();readAbort.abort();await assert.rejects(PublicationDocument.open(ordinary,built.descriptor,{signal:readAbort.signal}),{name:'AbortError'});
 const accessor={};Object.defineProperty(accessor,'value',{enumerable:true,get(){throw new Error('must not invoke');}});await assert.rejects(built.builder.upsert('records','b',accessor),{code:'INVALID'});
});

test('legacy materialized values preserve exact order, nested content and JSON identities',async()=>{
 for(const version of [1,2,3,4,5]){
  const workspace=memory(),scope=owner(),records=[{id:'b',date:'002',body:'Original\nbody',source:{revision:'a'.repeat(64)}},{id:'a',date:'001',results:{statements:[{id:'result',text:'Exact result'}]}}],{descriptor}=await build(workspace,scope,records),reader=await PublicationDocument.open(workspace,descriptor),items=[];
  for await(const item of reader.items('records'))items.push(item.value);
  assert.equal(digest(serialize(items)),digest(serialize(records)),'legacy source '+version+' retains unchanged row values/order');assert.deepEqual(await reader.window('files'),{items:[],total:0,offset:0,next:null});
 }
});


test('method cancellation interrupts a value between blocks and read-only key iteration skips bodies',async()=>{
 const workspace=memory(),scope=owner(),builder=new PublicationDocumentBuilder(workspace,{owner:scope,collections:schema}),abort=new AbortController(),write=workspace.writeMetadata;
 workspace.writeMetadata=async(file,text)=>{await write(file,text);abort.abort();};
 await assert.rejects(builder.append('records','cancelled',{body:randomBytes(128*1024).toString('hex')},{signal:abort.signal}),{name:'AbortError'});assert.equal(builder.count('records'),0);assert.equal(workspace.writes.length,1);
 workspace.writeMetadata=write;await builder.append('records','complete',{body:randomBytes(128*1024).toString('hex')});const descriptor=await builder.finish(),reader=await PublicationDocument.open(workspace,descriptor),keys=[];
 workspace.reads.length=0;for await(const key of reader.keys('records'))keys.push(key);assert.deepEqual(keys,['complete']);assert.ok(workspace.reads.length<8);assert.ok(!workspace.reads.some(file=>workspace.files.get(file).includes('"type": "bytes"')));
 const abortRead=new AbortController(),read=workspace.readMetadata;workspace.readMetadata=async(file,limit)=>{const value=await read(file,limit);if(value?.includes('"type": "bytes"'))abortRead.abort();return value;};
 await assert.rejects(reader.get('records','complete',{signal:abortRead.signal}),{name:'AbortError'});assert.equal(workspace.reads.filter(file=>workspace.files.get(file).includes('"type": "bytes"')).length,1);
 workspace.readMetadata=read;assert.ok((await reader.get('records','complete')).body.length>128*1024,'one cancelled operation does not poison the reader');
});

test('long escaped keys stay inside node limits and invalid schemas fail before writes',async()=>{
 const workspace=memory(),scope=owner(),builder=new PublicationDocumentBuilder(workspace,{owner:scope,collections:schema});
 for(let i=0;i<80;i++){const suffix=String(i).padStart(3,'0'),id='x'.repeat(377)+suffix;await builder.append('records',id,{i},{indexes:{scopeDate:'y'.repeat(377)+suffix}});}
 assert.equal((await builder.window('records',{index:'scopeDate',reverse:true,limit:1})).items[0].value.i,79);assert.ok([...workspace.files.values()].every(value=>Buffer.byteLength(value)<=65536));
 await assert.rejects(builder.append('records','\n'.repeat(192),{}),{code:'INVALID'});assert.throws(()=>new PublicationDocumentBuilder(workspace,{owner:scope,collections:{records:{indexes:['same','same']}}}),{code:'INVALID'});
 const accessor={};Object.defineProperty(accessor,'value',{enumerable:true,get(){assert.fail('accessor must never run');}});await assert.rejects(builder.append('records','accessor',accessor),{code:'INVALID'});
 const descriptor=await builder.finish();assert.deepEqual(await (await PublicationDocument.open(workspace,descriptor)).verify(),{collections:2,items:80});
});


test('validated forks publish new roots without changing earlier review checkpoints',async()=>{
 const workspace=memory(),scope=owner('output'),builder=new PublicationDocumentBuilder(workspace,{owner:scope,collections:{decisions:{indexes:[]}}});await builder.append('decisions','one',{reason:'Original'});const first=await builder.finish({header:{fingerprint:'a'.repeat(64)}});
 const fork=await PublicationDocumentBuilder.open(workspace,first,{owner:scope});await fork.upsert('decisions','one',{reason:'Amended'});await fork.append('decisions','two',{reason:'Additional'});const second=await fork.finish({header:{fingerprint:'a'.repeat(64)}});
 const before=await PublicationDocument.open(workspace,first),after=await PublicationDocument.open(workspace,second);assert.equal(before.count('decisions'),1);assert.equal(after.count('decisions'),2);assert.equal((await before.get('decisions','one')).reason,'Original');assert.equal((await after.get('decisions','one')).reason,'Amended');assert.notEqual(first.root,second.root);
 const foreign={...workspace,websiteId:randomUUID()};await assert.rejects(PublicationDocumentBuilder.open(foreign,first),{code:'JOB_DAMAGED'});const adopted=await PublicationDocumentBuilder.open(foreign,first,{owner:scope});assert.equal(adopted.count('decisions'),1);
});


test('hot immutable nodes remain reusable during bounded cache eviction',async()=>{
 const workspace=memory(),blocks=new PublicationDocumentBlocks(workspace,owner()),hotValue={text:'Frequently visited branch'},hot=await blocks.put('value',hotValue);
 for(let i=0;i<1200;i++){
  await blocks.put('value',{position:i,text:'x'.repeat(2048)});
  const reads=workspace.reads.length;assert.deepEqual(await blocks.read('value',hot),hotValue);assert.equal(workspace.reads.length,reads);
  assert.ok(blocks.cacheBytes<=1024*1024);assert.ok(blocks.cache.size<=1024);
 }
 const first=[...workspace.files.keys()][1],reads=workspace.reads.length;await blocks.read('value',first.slice(first.lastIndexOf('/')+6,-5));assert.equal(workspace.reads.length,reads+1);
});


test('publication index batches retain all roots while avoiding intermediate durable pages',async t=>{
 const indexes=Array.from({length:8},(_,i)=>'scope'+i),collections={records:{indexes},files:{indexes:[]}};
 async function captured(eager){
  const workspace=memory(),builder=new PublicationDocumentBuilder(workspace,{owner:owner(),collections});
  let peakNodes=0,peakBytes=0;
  for(let i=0;i<160;i++){
   const id=String(i*73%160).padStart(3,'0'),value={id,title:'Exact '+id},keys=Object.fromEntries(indexes.map((name,n)=>[name,'group'+n+'/'+id]));
   await builder.append('records',id,value,{indexes:keys});
   await builder.append('files',id,{name:id+'.html'});
   if(eager)await builder.flushIndexes();
   peakNodes=Math.max(peakNodes,builder.index.pending.size);peakBytes=Math.max(peakBytes,builder.index.pendingBytes);
  }
  const descriptor=await builder.finish(),reader=await PublicationDocument.open(workspace,descriptor);
  assert.deepEqual(await reader.verify(),{collections:2,items:320});
  assert.equal(builder.index.pending.size,0);assert.equal(builder.index.pendingBytes,0);
  assert.ok(peakNodes<512);assert.ok(peakBytes<4*1024*1024);
  for(const name of indexes){const page=await reader.window('records',{index:name,prefix:'group'+indexes.indexOf(name)+'/',offset:159,limit:1});assert.equal(page.total,160);assert.equal(page.items[0].key,'159');}
  return {writes:workspace.writes.filter(file=>file.includes('/pd-i-')).length,rows:await Array.fromAsync(reader.items('records')),peakNodes,peakBytes};
 }
 const eager=await captured(true),batched=await captured(false);assert.deepEqual(batched.rows,eager.rows);
 assert.ok(batched.writes<eager.writes/3,'Bounded batches must avoid persisting each intermediate index path');
 t.diagnostic(JSON.stringify({eagerIndexWrites:eager.writes,batchedIndexWrites:batched.writes,peakPendingNodes:batched.peakNodes,peakPendingBytes:batched.peakBytes}));
});

test('paused publication iterators retain their exact pending snapshot across batched upserts',async()=>{
 const workspace=memory(),builder=new PublicationDocumentBuilder(workspace,{owner:owner(),collections:schema});
 for(let i=0;i<13;i++){const id=String(i).padStart(3,'0');await builder.append('records',id,{id,title:'Before '+id},{indexes:{scopeDate:'before/'+id}});}
 const iterator=builder.items('records',{index:'scopeDate',prefix:'before/'}),original=[(await iterator.next()).value];
 for(let i=0;i<80;i++){const id=String(i).padStart(3,'0');await builder.upsert('records',id,{id,title:'After '+id},{indexes:{scopeDate:'after/'+id}});}
 await builder.flushIndexes();builder.index.cache.clear();builder.index.cacheBytes=0;builder.blocks.cache.clear();builder.blocks.cacheBytes=0;
 for await(const row of iterator)original.push(row);
 assert.deepEqual(original.map(row=>row.value.title),Array.from({length:13},(_,i)=>'Before '+String(i).padStart(3,'0')));
 assert.equal(builder.snapshots.size,0);assert.equal((await builder.get('records','012')).title,'After 012');
 const descriptor=await builder.finish(),reader=await PublicationDocument.open(workspace,descriptor);
 assert.equal((await reader.window('records',{index:'scopeDate',prefix:'before/'})).total,0);
 assert.equal((await reader.window('records',{index:'scopeDate',prefix:'after/'})).total,80);await reader.verify();
});

test('an aborted multi-root checkpoint preserves the admitted rows and allows exact retry',async()=>{
 const workspace=memory(),builder=new PublicationDocumentBuilder(workspace,{owner:owner(),collections:schema});
 for(let i=0;i<31;i++)await builder.append('records',String(i),{id:String(i)},{indexes:{scopeDate:'book/'+String(i).padStart(3,'0'),original:String(i)}});
 const abort=new AbortController(),write=workspace.writeMetadata;let writes=0;
 workspace.writeMetadata=async(file,text)=>{await write(file,text);if(file.includes('/pd-i-')&&++writes===2)abort.abort();};
 // Grow through the unchanged production capacity bound instead of relying
 // on an arbitrary number of appends to force an intermediate checkpoint.
 let interrupted=null,admitted=0;
 for(let i=31;i<4096;i++){
  const id=String(i);admitted=builder.count('records');
  try{await builder.append('records',id,{id,title:'Unacknowledged'},{indexes:{scopeDate:'book/'+id.padStart(3,'0'),original:id},signal:abort.signal});}
  catch(error){assert.equal(error.name,'AbortError');interrupted=id;break;}
 }
 assert.notEqual(interrupted,null,'The actual index capacity must trigger a flush');assert.equal(writes,2);
 assert.equal(builder.count('records'),admitted);assert.equal(await builder.get('records',interrupted),null);assert.equal((await builder.get('records','30')).id,'30');
 assert.equal(builder.busy,false);assert.equal(builder.finished,false);assert.ok(builder.index.pending.size>0);
 workspace.writeMetadata=write;
 await builder.append('records',interrupted,{id:interrupted,title:'Acknowledged'},{indexes:{scopeDate:'book/'+interrupted.padStart(3,'0'),original:interrupted}});
 const descriptor=await builder.finish(),reader=await PublicationDocument.open(workspace,descriptor);assert.equal((await reader.get('records',interrupted)).title,'Acknowledged');
 assert.deepEqual(await reader.verify(),{collections:2,items:admitted+1});
});
