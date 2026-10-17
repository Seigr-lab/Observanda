import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordResultIndex} from '../src/record-result-index.js';
import {validBlockedRecord} from '../src/record-block-store.js';
import {recordEncoding,recordContentRevision} from '../src/record-encoding.js';
import {digest,serialize} from '../src/storage-format.js';
function memory(){
 const nodes=new Map();return {nodes,reads:0,writes:0,tree(){return new RecordValueTree(this);},
  async put(kind,value){const encoded=serialize(value),revision=digest(encoded);assert.ok(Buffer.byteLength(encoded)<=65536);nodes.set(kind+':'+revision,encoded);this.writes++;return revision;},
  async read(kind,revision){this.reads++;const encoded=nodes.get(kind+':'+revision);assert.equal(digest(encoded),revision);return JSON.parse(encoded);}
 };
}
async function fixture(count=19){
 const figures=[randomUUID(),randomUUID()],statements=Array.from({length:count},(_,i)=>({id:randomUUID(),kind:i%3===1?'figure':'conclusion',basis:'authored',source:null,title:'Statement '+i,text:'Observed value '+i,limitations:'Retained context',...(i%3===1?{figureId:figures[i%2]}:{})}));
 const record={id:randomUUID(),notebookId:randomUUID(),title:'Original',results:{version:1,statements}},blocks=memory(),root=await blocks.tree().retain(record),source=new RecordDocument(blocks,root,{mutable:true});
 const resultIndex=await RecordResultIndex.retain(source),document=new RecordDocument(blocks,root,{mutable:true,resultIndex});return {record,figures,blocks,source,resultIndex,document};
}
const row=(statement,position)=>({id:statement.id,position,figureId:statement.kind==='figure'?statement.figureId:null});
function guardSelectedPositions(document,allowed){
 const select=document.tree.select.bind(document.tree);
 document.tree.select=async(revision,path)=>{
  const position=path[0]==='results'&&path[1]==='statements'?path[2]:path[0]==='statements'?path[1]:undefined;
  if(position!==undefined)assert.ok(allowed.includes(Number(position)),'Incremental retention read an unchanged statement position');
  return select(revision,path);
 };
 return ()=>{document.tree.select=select;};
}

test('selected results and late figure windows seek by identity without scanning statements',async t=>{
 for(const count of [19,257,2003]){
  const f=await fixture(count),{document,record,blocks,figures}=f;blocks.reads=0;
  document.items=async function*(){throw Error('Indexed result lookup scanned source statements');};
  const index=await RecordResultIndex.open(document),last=record.results.statements.at(-1);
  assert.deepEqual(await index.statement(last.id),row(last,count-1));assert.equal(await index.statement(randomUUID()),null);
  assert.deepEqual(await index.window({offset:count-3}),{rows:record.results.statements.slice(-3).map((s,i)=>row(s,count-3+i)),total:count,offset:count-3});
  assert.deepEqual(await index.window({offset:count+50}),{rows:[row(last,count-1)],total:count,offset:count-1});
  const associated=record.results.statements.map(row).filter(r=>r.figureId===figures[0]),offset=Math.max(0,associated.length-3);
  assert.deepEqual(await index.figureWindow(figures[0],{offset}),{rows:associated.slice(offset),total:associated.length,offset});
  assert.equal(await index.hasFigure(figures[1]),true);assert.equal(await index.hasFigure(randomUUID()),false);
  assert.deepEqual((await document.field(['results','statements',String(count-1)])).value,last);
  t.diagnostic(`${count} statements: ${blocks.reads} logical block reads for selected and late windows`);
 }
});

test('result descriptors reuse unchanged owners and changed results preserve historical values and digests',async()=>{
 const f=await fixture(97),{document,record,blocks,resultIndex}=f,index=await RecordResultIndex.open(document);await index.verify();
 assert.deepEqual(await document.encoding(),{...recordEncoding(record),contentRevision:recordContentRevision(record)});
 assert.equal(await RecordResultIndex.open(f.source),null,'An unindexed original acquired a reader descriptor');
 const title=await document.replace(['title'],'Later title');title.items=async function*(){throw Error('Unchanged result owner was scanned');};assert.deepEqual(await RecordResultIndex.retain(title),resultIndex);
 const amended=await document.replace(['results','statements','96','text'],'Reconsidered result');assert.equal(await RecordResultIndex.open(amended),null);
 const amendedIndex=await RecordResultIndex.retain(amended);assert.notEqual(amendedIndex.source,resultIndex.source);
 const retained=new RecordDocument(blocks,amended.root,{mutable:true,resultIndex:amendedIndex});await (await RecordResultIndex.open(retained)).verify();
 assert.equal((await document.field(['results','statements','96','text'])).value,record.results.statements[96].text);
 const deleted=await retained.splice(['results','statements'],0,1,[]),value=await RecordResultIndex.retain(deleted),next=new RecordResultIndex(deleted,value);await next.verify();
 assert.equal((await next.statement(record.results.statements[96].id)).position,95);assert.equal(await next.statement(record.results.statements[0].id),null);
 assert.equal((await index.statement(record.results.statements[96].id)).position,96);
 assert.deepEqual(await document.encoding(),{...recordEncoding(record),contentRevision:recordContentRevision(record)});
});

test('empty result owners, absent owners, cancellation and invalid windows stay distinct',async()=>{
 const f=await fixture(0),index=await RecordResultIndex.open(f.document);assert.equal(f.resultIndex.count,0);assert.equal(f.resultIndex.root,null);await index.verify();
 assert.deepEqual(await index.window({offset:100}),{rows:[],total:0,offset:0});assert.deepEqual(await index.figureWindow(f.figures[0]),{rows:[],total:0,offset:0});
 const absent=await f.document.property([],'results',null,{remove:true});assert.equal(await RecordResultIndex.open(absent),null);assert.equal(await RecordResultIndex.retain(absent),null);
 for(const options of [{offset:-1},{offset:0.5},{limit:0},{limit:33}]){await assert.rejects(index.window(options),{code:'INVALID'});await assert.rejects(index.figureWindow(f.figures[0],options),{code:'INVALID'});}
 for(const run of [()=>index.statement('missing'),()=>index.figureWindow('missing'),()=>index.hasFigure('missing')])await assert.rejects(run(),{code:'INVALID'});
 const controller=new AbortController();controller.abort();const options={signal:controller.signal};
 for(const run of [()=>RecordResultIndex.open(f.document,options),()=>RecordResultIndex.retain(f.document,options),()=>index.verify(options),()=>index.statement(randomUUID(),options),()=>index.window(options),()=>index.figureWindow(f.figures[0],options),()=>index.hasFigure(f.figures[0],options)])await assert.rejects(run(),{name:'AbortError'});
});

test('independent result verification rejects missing associations, forged identities and source mismatches',async()=>{
 const f=await fixture(97),pristine=await RecordResultIndex.open(f.document),statement=f.record.results.statements[1],entry=await pristine.index.find(pristine.value,'id:'+statement.id),original=await f.document.tree.read(entry.revision);
 const cases=[
  async index=>{index.index.allowSparseBranches=true;index.value.root=await index.index.remove(index.value.root,'figure:'+statement.figureId+':'+String(1).padStart(16,'0'));},
  async index=>{index.value.root=await index.index.change(index.value.root,'id:'+statement.id,await f.document.tree.retain({...original,position:2}));},
  async index=>{index.value.root=await index.index.change(index.value.root,'id:'+randomUUID(),entry.revision);},
  async index=>{index.value.root=await index.index.change(index.value.root,'figure:'+randomUUID()+':'+String(1).padStart(16,'0'),entry.revision);}
 ];
 for(const damage of cases){const index=new RecordResultIndex(f.document,structuredClone(f.resultIndex));await damage(index);await index.index.flush(index.value.root);await assert.rejects(index.verify(),{code:'CATALOGUE_DAMAGED'});}
 const wrongCount={...f.resultIndex,count:f.resultIndex.count+1};await assert.rejects(RecordResultIndex.open(new RecordDocument(f.blocks,f.document.root,{resultIndex:wrongCount})),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(new RecordResultIndex(f.document,{...f.resultIndex,source:'0'.repeat(64)}).verify(),{code:'CATALOGUE_DAMAGED'});
 for(const bad of [{...f.resultIndex,root:null},{...f.resultIndex,version:2},{...f.resultIndex,extra:true}])assert.throws(()=>new RecordResultIndex(f.document,bad),{code:'CATALOGUE_DAMAGED'});
 const repeated=await f.document.replace(['results','statements','96','id'],f.record.results.statements[0].id);await assert.rejects(RecordResultIndex.retain(repeated),{code:'CATALOGUE_DAMAGED'});
 const invalidFigure=await f.document.replace(['results','statements','1','figureId'],'unknown');await assert.rejects(RecordResultIndex.retain(invalidFigure),{code:'CATALOGUE_DAMAGED'});
});

test('current record manifests require result indexes while older representations remain readable',async()=>{
 const f=await fixture(0),base={format:'observanda-record-blocks',version:1,id:f.record.id,notebookId:f.record.notebookId,root:f.document.root},attemptIndex={version:2,source:digest('attempt'),root:null,preparations:0,events:0,assessments:0},methodIndex={version:1,source:digest('relations'),relations:0,root:null};
 for(const manifest of [base,{...base,version:2,attemptIndex},{...base,version:3,methodIndex},{...base,version:3,attemptIndex,methodIndex}])assert.ok(validBlockedRecord(manifest));
 for(const addition of [{},{attemptIndex},{methodIndex},{attemptIndex,methodIndex}])assert.ok(validBlockedRecord({...base,version:4,resultIndex:f.resultIndex,...addition}));
 for(const manifest of [{...base,version:4},{...base,version:4,resultIndex:null},{...base,version:4,resultIndex:{...f.resultIndex,count:1}},{...base,resultIndex:f.resultIndex},{...base,version:4,resultIndex:f.resultIndex,extra:true}])assert.ok(!validBlockedRecord(manifest));
});


test('selected result edits and appends amend only changed positions and reuse identity roots',async t=>{
 for(const count of [19,2003]){
  const f=await fixture(count),{document,record,blocks,resultIndex}=f;
  const text=await document.replace(['results','statements',String(count-1),'text'],'Later interpretation');
  text.items=async function*(){throw Error('Text edit enumerated the result collection');};blocks.reads=0;
  const restoreText=count>32?guardSelectedPositions(text,[count-1]):()=>{};
  const amended=await RecordResultIndex.retain(text);restoreText();assert.deepEqual(amended.root,resultIndex.root);assert.notEqual(amended.source,resultIndex.source);const textReads=blocks.reads;
  const added={...record.results.statements[0],id:randomUUID(),title:'Appended result'},appended=await document.splice(['results','statements'],count,0,[added]);
  appended.items=async function*(){throw Error('Append enumerated the result collection');};blocks.reads=0;
  const restoreAppend=count>32?guardSelectedPositions(appended,[count]):()=>{};
  const next=await RecordResultIndex.retain(appended),appendReads=blocks.reads;restoreAppend();const index=new RecordResultIndex(appended,next);
  assert.equal(next.count,count+1);assert.deepEqual(await index.statement(added.id),row(added,count));
  assert.equal((await index.statement(record.results.statements[0].id)).position,0);
  const original=new RecordResultIndex(document,resultIndex);assert.equal(await original.statement(added.id),null);
  const duplicate=await document.splice(['results','statements'],count,0,[record.results.statements[0]]);duplicate.items=appended.items;
  await assert.rejects(RecordResultIndex.retain(duplicate),{code:'CATALOGUE_DAMAGED'});
  const reopened=new RecordDocument(blocks,appended.root,{resultIndex:next});await (await RecordResultIndex.open(reopened)).verify();
  t.diagnostic(`${count} earlier statements: text retention ${textReads} reads; append retention ${appendReads} reads`);
 }
});

test('incremental result retention reorders across batches and removes obsolete figure and identity keys',async()=>{
 const f=await fixture(97),{document,record,blocks}=f;
 const reverse=await document.replace(['results','statements'],[...record.results.statements].reverse());
 reverse.items=async function*(){throw Error('Reordering enumerated the complete source collection');};
 const reversedValue=await RecordResultIndex.retain(reverse),reversed=new RecordDocument(blocks,reverse.root,{mutable:true,resultIndex:reversedValue}),index=await RecordResultIndex.open(reversed);await index.verify();
 assert.equal((await index.statement(record.results.statements[0].id)).position,96);assert.equal((await index.statement(record.results.statements[96].id)).position,0);
 const oldFigure=record.results.statements[1],newFigure=randomUUID(),changed=await document.replace(['results','statements','1','figureId'],newFigure);changed.items=reverse.items;
 const changedValue=await RecordResultIndex.retain(changed),changedIndex=new RecordResultIndex(changed,changedValue);
 assert.deepEqual(await changedIndex.figureWindow(newFigure),{rows:[{id:oldFigure.id,position:1,figureId:newFigure}],total:1,offset:0});
 assert.equal((await changedIndex.figureWindow(oldFigure.figureId,{limit:32})).rows.some(r=>r.id===oldFigure.id),false);
 const fresh=new RecordDocument(blocks,changed.root,{resultIndex:changedValue});await (await RecordResultIndex.open(fresh)).verify();
 const removed=await reversed.splice(['results','statements'],0,97,[]);removed.items=reverse.items;const empty=await RecordResultIndex.retain(removed);
 assert.equal(empty.count,0);assert.equal(empty.root,null);assert.deepEqual(await new RecordResultIndex(removed,empty).window(),{rows:[],total:0,offset:0});
 assert.equal((await (await RecordResultIndex.open(document)).statement(oldFigure.id)).figureId,oldFigure.figureId);
});
