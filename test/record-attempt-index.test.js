import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordAttemptIndex} from '../src/record-attempt-index.js';
import {attemptFactPosition,attemptSuccessor,attemptValueContext} from '../src/record-attempt-context.js';
import {recordAttemptWindow} from '../src/record-attempt-window.js';
import {recordRunComparison} from '../src/record-run-comparison.js';
import {digest,serialize} from '../src/storage-format.js';
import {preparation,event,assessment} from './fixtures/attempts.js';

function memory(){
 const nodes=new Map();return {nodes,reads:0,writes:0,
  tree(){return new RecordValueTree(this);},
  async put(kind,value){const encoded=serialize(value),hash=digest(encoded);assert.ok(Buffer.byteLength(encoded)<=65536);nodes.set(kind+':'+hash,encoded);this.writes++;return hash;},
  async read(kind,hash){this.reads++;const encoded=nodes.get(kind+':'+hash);assert.equal(digest(encoded),hash);return JSON.parse(encoded);}
 };
}
async function fixture(count=19){
 const p=preparation(),q={...preparation(),supersedes:p.id,reason:'Changed context',criteria:[]},events=Array.from({length:count},(_,i)=>event(p,{label:'Acquisition '+i}));
 events.push({...events[0],id:randomUUID(),supersedes:events[0].id,reason:'Receipt correction'});
 const record={title:'Original',attempt:{version:1,preparations:[p,q],events,assessments:[assessment(p)]}},blocks=memory(),root=await blocks.tree().retain(record),source=new RecordDocument(blocks,root,{mutable:true});
 const attemptIndex=await RecordAttemptIndex.retain(source),document=new RecordDocument(blocks,root,{mutable:true,attemptIndex});return {record,blocks,document,attemptIndex};
}
test('indexed run lookup and reader windows do not scan earlier facts as histories grow',async t=>{
 // This independently qualifies the representation beyond existing admission
 // ceilings; lifting those ceilings remains a separate authoring contract.
 for(const count of [19,257,2003]){
  const f=await fixture(count),{document,record,blocks}=f;blocks.reads=0;
  const items=document.items.bind(document);
  document.items=async function*(path,options={}){assert.ok(Number.isSafeInteger(options.limit)&&options.limit<=4,'An indexed reader scanned a history');yield* items(path,options);};
  assert.equal(await attemptFactPosition(document,'events',record.attempt.events[count-1].id),count-1);assert.equal(await attemptFactPosition(document,'preparations',record.attempt.events[count-1].id),-1);
  assert.equal(await attemptSuccessor(document,'events',record.attempt.events[0].id),record.attempt.events[count].id);
  const context=await attemptValueContext(document,'attempt:assessment:'+randomUUID());assert.equal(context.attempt.preparations[0].id,record.attempt.preparations[0].id);
  const window=await recordAttemptWindow(document,{windows:{events:count-3}});assert.equal(window.pages.events.total,count+1);assert.equal(window.attempt.events.at(-1).id,record.attempt.events[count].id);assert.equal(window.window.preparationPositions[record.attempt.preparations[0].id],0);
  const reads=blocks.reads;assert.ok(reads<400,`${count} facts: ${reads} block reads`);t.diagnostic(`${count} prior events: ${reads} block reads for selected lookup, correction, context and reader window`);
 }
});
test('run indexes follow only their pinned source and preserve compatibility with unindexed originals',async()=>{
 const {document,attemptIndex,record,blocks}=await fixture();await (await RecordAttemptIndex.open(document)).verify();
 const next=await document.replace(['title'],'Later explanation');assert.deepEqual(await RecordAttemptIndex.retain(next),attemptIndex);
 const item=event(record.attempt.preparations[1]),amended=await document.splice(['attempt','events'],record.attempt.events.length,0,[item]);assert.equal(await RecordAttemptIndex.open(amended),null);
 const fresh=await RecordAttemptIndex.retain(amended);assert.notEqual(fresh.source,attemptIndex.source);assert.equal(fresh.events,attemptIndex.events+1);
 const indexed=new RecordDocument(blocks,amended.root,{attemptIndex:fresh});await (await RecordAttemptIndex.open(indexed)).verify();assert.equal(await attemptFactPosition(indexed,'events',item.id),record.attempt.events.length);
 assert.equal(await attemptFactPosition(document,'events',item.id),-1);assert.deepEqual(await document.tree.read(document.root),record);
 const legacy=new RecordDocument(blocks,document.root);assert.equal(await RecordAttemptIndex.open(legacy),null);assert.equal(await attemptFactPosition(legacy,'events',record.attempt.events.at(-1).id),record.attempt.events.length-1);assert.deepEqual(await recordAttemptWindow(legacy),await recordAttemptWindow(document));
 const aborted=new AbortController();aborted.abort();await assert.rejects(RecordAttemptIndex.retain(amended,{signal:aborted.signal}),{name:'AbortError'});
});
test('run index verification rejects omissions, invented entries, wrong positions and cyclic corrections',async()=>{
 const {document,attemptIndex,record}=await fixture();const pristine=await RecordAttemptIndex.open(document);
 for(const value of [{...attemptIndex,events:attemptIndex.events+1},{...attemptIndex,root:null}])await assert.rejects(new RecordAttemptIndex(document,value).verify(),{code:'CATALOGUE_DAMAGED'});
 const original=await pristine.fact(record.attempt.events[0].id,'events');
 for(const [id,row] of [['id:'+original.id,{...original,position:1}],['id:'+randomUUID(),original]]){
  const index=new RecordAttemptIndex(document,{...attemptIndex});index.value.root=await index.index.change(index.value.root,id,await document.tree.retain(row));await index.index.flush(index.value.root);
  await assert.rejects(index.verify(),{code:'CATALOGUE_DAMAGED'});
 }
 const missing=new RecordAttemptIndex(document,{...attemptIndex});missing.index.allowSparseBranches=true;missing.value.root=await missing.index.remove(missing.value.root,'correction:'+record.attempt.events[0].id);await missing.index.flush(missing.value.root);await assert.rejects(missing.verify(),{code:'CATALOGUE_DAMAGED'});
 // Even an internally consistent index of an invalid source cannot loop.
 const cycle=await document.replace(['attempt','events','0','supersedes'],record.attempt.events.at(-1).id);
 await assert.rejects(RecordAttemptIndex.retain(cycle),{code:'CATALOGUE_DAMAGED'});
 // A damaged older descriptor can still contain a cyclic source. Its reader
 // must reject backward correction positions, rather than following forever.
 const legacy=new RecordAttemptIndex(cycle,{...attemptIndex,version:1,source:await cycle.reference(['attempt']),root:null});
 for await(const entry of pristine.index.entries(pristine.value))if(!entry.id.startsWith('current:')){
  const row=await document.tree.read(entry.revision),changed=row.id===original.id?{...row,supersedes:record.attempt.events.at(-1).id}:row;
  legacy.value.root=await legacy.index.change(legacy.value.root,entry.id,await document.tree.retain(changed));
 }
 legacy.value.root=await legacy.index.change(legacy.value.root,'correction:'+record.attempt.events.at(-1).id,await document.tree.retain({...original,supersedes:record.attempt.events.at(-1).id}));await legacy.index.flush(legacy.value.root);
 await assert.rejects(attemptSuccessor(new RecordDocument(document.blocks,cycle.root,{attemptIndex:legacy.value}),'events',original.id),{code:'CATALOGUE_DAMAGED'});
});

test('counted current-fact windows seek past corrected history without scanning it',async t=>{
 for(const count of [19,257,2003]){
  const {document,record,blocks}=await fixture(count);document.items=async function*(){throw Error('Current window scanned history');};blocks.reads=0;
  const index=await RecordAttemptIndex.open(document),page=await index.currentWindow('events',{offset:count-3});
  assert.equal(page.total,count);assert.equal(page.offset,count-3);assert.deepEqual(page.rows.map(r=>r.id),record.attempt.events.slice(-3).map(r=>r.id));
  const clamped=await index.currentWindow('events',{offset:count+100});assert.equal(clamped.offset,count-1);assert.deepEqual(clamped.rows.map(r=>r.id),[record.attempt.events.at(-1).id]);
  assert.equal((await index.currentWindow('preparations')).rows[0].id,record.attempt.preparations[1].id);
  assert.ok(blocks.reads<320,`${count}: ${blocks.reads} reads`);t.diagnostic(`${count} earlier events: ${blocks.reads} reads for late, clamped and preparation current windows`);
  const controller=new AbortController();controller.abort();await assert.rejects(index.currentWindow('events',{signal:controller.signal}),{name:'AbortError'});
 }
});

test('current comparison windows preserve exact preparation context and old immutable totals',async()=>{
 const f=await fixture(2003);let document=await f.document.property([],'sections',[]);document=await document.property([],'relations',[]);
 const original=f.record.attempt.events.at(-1),correction={...original,id:randomUUID(),supersedes:original.id,reason:'Another interpretation',label:'Latest corrected event'},next=await document.splice(['attempt','events'],f.record.attempt.events.length,0,[correction]),value=await RecordAttemptIndex.retain(next),indexed=new RecordDocument(f.blocks,next.root,{attemptIndex:value});
 for(const source of [document,indexed]){
  const items=source.items;source.items=async function*(path,options){assert.notEqual(path[0],'attempt','Comparison scanned history for its count');yield* items.call(this,path,options);};
 }
 const before=await recordRunComparison(document,{windows:{events:2000}}),after=await recordRunComparison(indexed,{windows:{events:2000}});
 assert.equal(before.windows.events.total,2003);assert.equal(after.windows.events.total,2003);assert.equal(after.attempt.events.at(-1).label,'Latest corrected event');assert.notEqual(before.attempt.events.at(-1).label,after.attempt.events.at(-1).label);
 assert.equal(after.attempt.assessments[0].preparationNumber,1);assert.equal(after.attempt.assessments[0].criterion,f.record.attempt.preparations[0].criteria[0].label);
});

test('current-fact indexes reject omitted and superseded entries and retain version-one compatibility',async()=>{
 const {document,attemptIndex,record}=await fixture(96),index=await RecordAttemptIndex.open(document),first=record.attempt.events[0],current=record.attempt.events[1];
 const key=position=>'current:events:'+String(position).padStart(16,'0');
 for(const damage of ['omitted','superseded']){
  const altered=new RecordAttemptIndex(document,{...attemptIndex});
  if(damage==='omitted')altered.value.root=await altered.index.remove(altered.value.root,key(1));
  else altered.value.root=await altered.index.change(altered.value.root,key(0),(await index.index.find(index.value,'id:'+first.id)).revision);
  await altered.index.flush(altered.value.root);await assert.rejects(altered.verify(),{code:'CATALOGUE_DAMAGED'});
 }
 // Rebuild the original version-one key set, with no counted-current entries.
 const legacy=new RecordAttemptIndex(document,{...attemptIndex,version:1,root:null});
 for await(const entry of index.index.entries(index.value))if(!entry.id.startsWith('current:'))legacy.value.root=await legacy.index.change(legacy.value.root,entry.id,entry.revision);
 await legacy.index.flush(legacy.value.root);await legacy.verify();
 const old=new RecordDocument(document.blocks,document.root,{mutable:true,attemptIndex:legacy.value});assert.deepEqual(await RecordAttemptIndex.retain(old),legacy.value);
 assert.equal((await (await RecordAttemptIndex.open(old)).fact(current.id,'events')).position,1);
 const changed=await old.splice(['attempt','events'],record.attempt.events.length,0,[event(record.attempt.preparations[1])]),upgraded=await RecordAttemptIndex.retain(changed);assert.equal(upgraded.version,2);await new RecordAttemptIndex(changed,upgraded).verify();
 assert.equal((await new RecordAttemptIndex(changed,upgraded).currentWindow('events')).total,97);
});

test('successive correction batches remove obsolete current leaves without changing older windows',async()=>{
 const f=await fixture(97),original=await RecordAttemptIndex.open(f.document);let document=f.document;
 for(let pass=0;pass<2;pass++){
  const before=await RecordAttemptIndex.open(document),current=[];
  for(let offset=0;offset<97;offset+=32){const page=await before.currentWindow('events',{offset,limit:32});current.push(...page.rows);}
  assert.equal(current.length,97);const facts=[];
  for(const row of current){const prior=(await document.field(['attempt','events',String(row.position)])).value;facts.push({...prior,id:randomUUID(),supersedes:prior.id,reason:'Reassessment batch '+pass});}
  const appended=await document.splice(['attempt','events'],before.value.events,0,facts),index=await RecordAttemptIndex.retain(appended);document=new RecordDocument(f.blocks,appended.root,{mutable:true,attemptIndex:index});
  const after=await RecordAttemptIndex.open(document);await after.verify();const page=await after.currentWindow('events',{offset:93});assert.equal(page.total,97);assert.deepEqual(page.rows.map(row=>row.id),facts.slice(-4).map(fact=>fact.id));
 }
 assert.equal((await original.currentWindow('events')).total,97);assert.equal((await original.currentWindow('events',{offset:96})).rows[0].id,f.record.attempt.events.at(-1).id);
 const empty=await f.document.replace(['attempt'],{version:1,preparations:[],events:[],assessments:[]}),index=new RecordAttemptIndex(empty,await RecordAttemptIndex.retain(empty));await index.verify();
 for(const group of ['preparations','events','assessments'])assert.deepEqual(await index.currentWindow(group,{offset:100}),{rows:[],total:0,offset:0});
 for(const [group,options] of [['unknown',{}],['events',{offset:-1}],['events',{limit:0}],['events',{limit:33}]])await assert.rejects(index.currentWindow(group,options),{code:'INVALID'});
});

test('only proven appends extend run indexes without re-indexing earlier facts',async t=>{
 for(const count of [31,1025]){
  const {document,record,blocks,attemptIndex}=await fixture(count),correction={...record.attempt.events.at(-1),id:randomUUID(),supersedes:record.attempt.events.at(-1).id,reason:'Later exact review'};
  document.items=async function*(){throw Error('Append walked the prior event history');};blocks.reads=0;const before=blocks.nodes.size;
  const appended=await document.splice(['attempt','events'],record.attempt.events.length,0,[correction]),titled=await appended.replace(['title'],'Updated after append');assert.deepEqual(titled.attemptAppendBase(),attemptIndex);
  const items=titled.items.bind(titled);titled.items=async function*(path,options){assert.equal(options.offset,attemptIndex[path[1]],'Index extension reread the existing prefix');yield* items(path,options);};
  const value=await RecordAttemptIndex.retain(titled),reads=blocks.reads,writes=blocks.nodes.size-before;assert.ok(reads<160,`${count}: ${reads} reads`);assert.ok(writes<40,`${count}: ${writes} nodes`);
  const indexed=new RecordDocument(blocks,titled.root,{attemptIndex:value});await (await RecordAttemptIndex.open(indexed)).verify();assert.equal(await attemptSuccessor(indexed,'events',record.attempt.events[0].id),correction.id);
  const changed=await appended.replace(['attempt','events','0','label'],'Changed existing fact');assert.equal(changed.attemptAppendBase(),null);
  const afterChange=await changed.splice(['attempt','events'],record.attempt.events.length+1,0,[event(record.attempt.preparations[0])]);assert.equal(afterChange.attemptAppendBase(),null);
  const rebuilt=await RecordAttemptIndex.retain(afterChange);await new RecordAttemptIndex(new RecordDocument(blocks,afterChange.root,{attemptIndex:rebuilt}),rebuilt).verify();
  const shifted=await appended.splice(['attempt','events'],0,1,[]);assert.equal(shifted.attemptAppendBase(),null);
  const property=await appended.property(['attempt'],'version',1);assert.equal(property.attemptAppendBase(),null);
  appended.root=document.root;assert.equal(appended.attemptAppendBase(),null,'An externally replaced root retained an append proof');
  t.diagnostic(`${count} prior events: tail and index extension used ${reads} reads and ${writes} new nodes`);
 }
});
