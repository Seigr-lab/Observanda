import {AppError,safeError} from '../src/errors.js';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {withOperationProgress,operationStage,operationAdvance,operationWork,operationTotal,operationSequence,operationTransfer} from '../src/operation-progress.js';
import {streamOperation} from '../src/operation-stream.js';
import {readProgressStream} from '../src/web/progress-stream.js';

test('progress scopes isolate concurrent work and restore enclosing stage counts',async()=>{
 const a=[],b=[];
 await Promise.all([a,b].map((events,index)=>withOperationProgress(event=>events.push(event),()=>operationStage('copy-files',{total:2,unit:'files'},async()=>{
  operationAdvance();
  await operationStage('verify-file',{total:10+index,unit:'bytes'},async()=>{await new Promise(resolve=>setImmediate(resolve));operationAdvance(10+index);operationWork({bytes:10+index});});
  operationAdvance();
 }))));
 for(const [index,events] of [a,b].entries()){
  const bytes=events.findLast(e=>e.stage==='verify-file'),files=events.findLast(e=>e.stage==='copy-files');
  assert.equal(bytes.completed,10+index);assert.equal(files.completed,2);assert.equal(files.activity.bytes,10+index);assert.deepEqual(bytes.stages,['preparing','copy-files','verify-file']);
 }
 const events=[];await assert.rejects(withOperationProgress(e=>events.push(e),()=>operationStage('verify-history',{total:3},async()=>{operationAdvance();throw Error('broken evidence');})),/broken evidence/);
 assert.equal(events.findLast(e=>e.stage==='verify-history').completed,1);
});

class Response extends EventEmitter{
 constructor(){super();this.events=[];this.writableNeedDrain=false;this.destroyed=false;this.writableEnded=false;}
 writeHead(){}
 write(line){this.events.push(JSON.parse(line));return !this.writableNeedDrain;}
 end(){this.writableEnded=true;}
}
test('a slow progress client retains only the latest observation and receives the final receipt',async()=>{
 const response=new Response();let release;const wait=new Promise(resolve=>{release=resolve;});
 const running=streamOperation(response,async({onProgress})=>{
  response.writableNeedDrain=true;for(let completed=0;completed<10000;completed++)onProgress({stage:'verify-history',completed});
  assert.equal(response.events.length,1);response.writableNeedDrain=false;response.emit('drain');
  assert.equal(response.events.at(-1).progress.completed,9999);await wait;return {copied:true};
 });
 release();await running;assert.deepEqual(response.events.at(-1),{result:{copied:true}});assert.equal(response.listenerCount('drain'),0);
});
test('heartbeats advance observation time without inventing completed work',async t=>{
 t.mock.timers.enable({apis:['setInterval','Date'],now:1000});
 const response=new Response();let release;const wait=new Promise(resolve=>{release=resolve;});
 const running=streamOperation(response,async({onProgress})=>{onProgress({stage:'verify-history',completed:1,advancedAt:1000});await wait;return {ok:true};});
 t.mock.timers.tick(10000);const progress=response.events.at(-1).progress;
 assert.equal(progress.completed,1);assert.equal(progress.advancedAt,1000);assert.equal(progress.observedAt,11000);assert.equal(progress.elapsedMs,10000);release();await running;
});
const response=chunks=>new ResponseBody(chunks);
class ResponseBody{
 constructor(chunks){this.body=new ReadableStream({pull(controller){const next=chunks.next();if(next.done)controller.close();else controller.enqueue(next.value);}});}
}
test('an arbitrarily long sequence of bounded status messages does not exhaust the result budget',async()=>{
 const chunk=new TextEncoder().encode(JSON.stringify({progress:{stage:'checking',item:'x'.repeat(1024*1024)}})+'\n');let count=0;
 const result=await readProgressStream(response((function*(){for(let i=0;i<66;i++)yield chunk;yield new TextEncoder().encode('{"result":{"ok":true}}\n');})()),()=>count++);
 assert.equal(count,66);assert.deepEqual(result,{ok:true});
});
test('the progress reader rejects malformed, interrupted, oversized and post-result messages',async()=>{
 for(const bytes of [Buffer.from('{"progress":{}}\n'),Buffer.from('{"result":{}}\n{"progress":{}}\n'),Buffer.from([255,10])])await assert.rejects(readProgressStream(response([bytes].values()),()=>{}));
 const huge=(function*(){const chunk=Buffer.alloc(1024*1024,32);for(let i=0;i<65;i++)yield chunk;})();await assert.rejects(readProgressStream(response(huge),()=>{}));
 const bytes=Buffer.from('{"progress":{"item":"Ø"}}\n{"result":{"ok":true}}\n');let item;
 assert.deepEqual(await readProgressStream(response((function*(){for(const byte of bytes)yield Uint8Array.of(byte);})()),e=>item=e.item),{ok:true});assert.equal(item,'Ø');
});


test('measured totals affect only the current stage and do not invent completed work',async()=>{
 const events=[];
 await withOperationProgress(event=>events.push(event),()=>operationStage('parent',{total:2},async()=>{
  operationAdvance();
  await operationStage('stream',{unit:'rows'},async()=>{
   operationAdvance(5);operationTotal(5);const advancedAt=events.at(-1).advancedAt;
   operationTotal(6);assert.equal(events.at(-1).advancedAt,advancedAt);operationTotal(5);
   for(const total of [4,-1,NaN,Infinity,5.5])assert.throws(()=>operationTotal(total),RangeError);
  });
 }));
 const stream=events.findLast(event=>event.stage==='stream'),parent=events.findLast(event=>event.stage==='parent');
 assert.equal(stream.completed,5);assert.equal(stream.total,5);assert.equal(parent.completed,1);assert.equal(parent.total,2);
});


test('declared task steps retain the outer operation through nested checks and record failure without false completion',async()=>{
 const events=[];
 await assert.rejects(withOperationProgress(event=>events.push(event),()=>operationSequence('conversion',['prepare','activate'],()=>operationStage('prepare',{},()=>operationSequence('checks',['revisions','analysis','history'],async()=>{
  await operationStage('revisions',{total:2},async()=>operationAdvance(2));
  await operationStage('analysis',{},async()=>{throw Error('invalid analysis');});
 })))) ,/invalid analysis/);
 const checking=events.find(event=>event.stage==='analysis');
 assert.deepEqual(checking.sequences.map(sequence=>sequence.steps.map(step=>step.state)),[['running','pending'],['completed','running','pending']]);
 const failed=events.findLast(event=>event.stage==='analysis');
 assert.deepEqual(failed.sequences[1].steps.map(step=>step.state),['completed','failed','pending']);
 assert.equal(events.some(event=>event.sequences?.[0].steps[1].state==='completed'),false);
 const other=[];
 await withOperationProgress(event=>other.push(event),()=>operationSequence('resumed',['reuse','transfer'],()=>operationStage('reuse',{},async()=>{})));
 assert.deepEqual(other.at(-1).sequences[0].steps.map(step=>step.state),['completed','skipped']);
 assert.equal(other.some(event=>event.sequences?.some(sequence=>sequence.id==='conversion')),false);
});


test('completed project transfer totals do not masquerade as the next project or the whole workspace',async()=>{
 const events=[];
 await withOperationProgress(event=>events.push(event),()=>operationStage('copy-workspace-projects',{total:2,unit:'projects'},async()=>{
  for(const owner of ['First project','Second project']){
   operationTransfer({phase:'copying',owner,files:0,bytes:0});
   operationTransfer({files:12,bytes:240});
   operationTransfer(null);operationAdvance();
  }
 }));
 const second=events.find(event=>event.transfer?.owner==='Second project');
 assert.equal(second.transfer.bytes,0);assert.equal(second.transfer.totalBytes,undefined);
 const finished=events.findLast(event=>event.stage==='copy-workspace-projects');
 assert.equal(finished.completed,2);assert.equal(finished.total,2);assert.equal(finished.transfer,undefined);
});

test('streamed access errors retain the same bounded owner identity as JSON responses',async()=>{
 const error=Object.assign(new AppError('ACCESS_LOCKED'),{projectId:randomUUID(),labBookId:randomUUID(),labBookName:'Protected observations'}),output=new Response();
 await streamOperation(output,async()=>{throw error;});assert.deepEqual(output.events.at(-1).error,safeError(error));assert.equal(output.events.at(-1).error.labBookId,error.labBookId);
 const bytes=new TextEncoder().encode(output.events.map(event=>JSON.stringify(event)).join('\n')+'\n');
 await assert.rejects(readProgressStream(response([bytes][Symbol.iterator]()),()=>{}),value=>value.projectId===error.projectId&&value.labBookId===error.labBookId&&value.labBookName===error.labBookName);
 const malformed=safeError(Object.assign(new AppError('ACCESS_LOCKED'),{projectId:'invalid',labBookId:error.labBookId,labBookName:error.labBookName}));assert.equal(malformed.projectId,undefined);assert.equal(malformed.labBookId,undefined);
 error.labBookName='Invalid/name';assert.equal(safeError(error).labBookName,undefined);
});
