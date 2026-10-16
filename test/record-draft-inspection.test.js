import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {sampleNotebook} from '../src/sample.js';
import {inspectRecordDraft} from '../src/record-draft-inspection.js';
import {validDraftChanges} from '../src/research-drafts.js';
import {recordDraftParts} from '../src/record-draft-parts.js';

const changes=record=>[{record,baseRevision:null,expectedRevision:null}];
async function* pieces(bytes,size){for(let at=0;at<bytes.length;at+=size)yield bytes.subarray(at,at+size);}
const inspect=(value,size=131072)=>inspectRecordDraft(pieces(Buffer.from(JSON.stringify(value)),size));

test('incremental draft validation preserves modern, legacy and unfinished record contracts at arbitrary transport boundaries',async()=>{
 const modern=sampleNotebook().entries[0];
 modern.title='Unfinished \u{1f52c} observation';modern.sections=[{id:randomUUID(),title:'One',body:'A\n\t\"\\B'},{id:randomUUID(),title:'Two',body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Preserved \u00e7 and \u{1f41d}'}]}]}}];
 modern.attachments=[{id:randomUUID(),kind:'image',caption:'',alt:'',transcript:'',share:false}];
 const legacy={...modern,author:'',chart:null};delete legacy.contributors;delete legacy.relations;delete legacy.figures;
 for(const record of [modern,legacy,{...modern,title:'',status:'',occurredOn:''}]){
  assert.equal(validDraftChanges(changes(record),true),true);
  // JSON object order is not part of the checkpoint contract.
  const payload=[{expectedRevision:null,record:Object.fromEntries(Object.entries(record).reverse()),baseRevision:null}];
  for(const size of [1,7,127,131072])assert.deepEqual(await inspect(payload,size),{base:{recordId:record.id,revision:null},title:record.title.slice(0,160)});
 }
 const parts=[];for await(const part of recordDraftParts([Buffer.from(JSON.stringify(changes(modern)))]))if(part.name==='sections')parts.push(part);
 assert.deepEqual(parts,[{kind:'array',name:'sections'},...modern.sections.map((value,index)=>({kind:'item',name:'sections',index,value}))]);
});

test('late invalid domain values, missing fields, competing legacy fields and duplicate identities cannot finish a checkpoint',async()=>{
 const record=sampleNotebook().entries[0],section={id:randomUUID(),title:'First',body:'Valid'};
 const variants=[
  {...record,sections:[section,{...section,id:randomUUID(),body:'x'.repeat(60001)}]},
  {...record,sections:[section,{...section,id:'incorrect'}]},
  {...record,sections:{}}, {...record,body:{type:'doc',content:[]}}, {...record,extra:'unsupported'},
  {...record,author:'conflicts with contributors'}, {...record,chart:null}, {...record,share:'false'},
  {...record,contributors:[record.contributors[0],record.contributors[0]]},
  {...record,figures:[...record.figures,{id:randomUUID(),kind:'invalid'}]},
  {...record,attachments:[{id:randomUUID(),kind:'unknown',caption:'',alt:'',transcript:'',share:false}]},
  {...record,outcome:'x'.repeat(501)}, {...record,attempt:{version:100}}, {...record,results:{version:100}}, {...record,template:{version:100}}
 ];
 for(const key of Object.keys(record)){const value={...record};delete value[key];variants.push(value);}
 for(const value of variants){assert.equal(validDraftChanges(changes(value),true),false);await assert.rejects(inspect(changes(value),127),{code:'INVALID'});}
});

test('checkpoint envelopes reject ambiguous JSON, invalid bases and incomplete content',async()=>{
 const record=sampleNotebook().entries[0],valid=JSON.stringify(changes(record));
 for(const value of [[],changes(record).concat(changes(record)),[{...changes(record)[0],extra:true}],[{...changes(record)[0],baseRevision:'a'.repeat(64)}],[{...changes(record)[0],expectedRevision:3}],{record}])await assert.rejects(inspect(value),{code:'INVALID'});
 const duplicateSection=JSON.stringify([{...changes(record)[0],record:{...record,sections:[{id:randomUUID(),title:'Original',body:'valid'}]}}]).replace('"title":"Original"','"title":"Original","title":"Hidden"');
 for(const text of [valid.replace('"baseRevision":null','"baseRevision":null,"baseRevision":null'),valid.replace('"title":','"__proto__":{},"title":'),duplicateSection])await assert.rejects(inspectRecordDraft(pieces(Buffer.from(text),1)),{code:'INVALID'});
 for(const text of [valid.slice(0,-1),valid+'x',''])await assert.rejects(inspectRecordDraft([Buffer.from(text)]),error=>['FORMAT','INVALID'].includes(error.code));
 const head=Buffer.from(valid.slice(0,valid.indexOf(record.title))),tail=Buffer.from(valid.slice(valid.indexOf(record.title)+record.title.length));
 for(const bytes of [Buffer.from([0xc0,0xaf]),Buffer.from([0xed,0xa0,0x80]),Buffer.from([0xf0,0x9f])])await assert.rejects(inspectRecordDraft(pieces(Buffer.concat([head,bytes,tail]),1)),{code:'FORMAT'});
});

test('cancellation and validation failure close the input before consuming an unbounded remainder',async()=>{
 for(const operation of ['cancel','invalid','return']){
  const controller=new AbortController();let consumed=0,closed=false;
  async function* input(){try{yield Buffer.from('[{"record":{"sections":[');for(let i=0;i<10000;i++){consumed++;yield Buffer.from((i?',':'')+JSON.stringify({id:randomUUID(),title:'Section',body:operation==='invalid'?false:'unchanged'}));}}finally{closed=true;}}
  if(operation==='invalid')await assert.rejects(inspectRecordDraft(input()),{code:'INVALID'});
  else{
   const parts=recordDraftParts(input(),{signal:controller.signal});assert.equal((await parts.next()).value.kind,'array');
   if(operation==='cancel'){controller.abort(Error('Stopped draft validation'));await assert.rejects(parts.next(),/Stopped draft validation/);}else await parts.return();
  }
  assert.equal(closed,true);assert.ok(consumed<10000);
 }
});

test('checkpoint validation processes a record larger than the available heap without retaining its section collection',async t=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--max-old-space-size=48','--max-semi-space-size=4','test/fixtures/inspect-large-draft.js'],{cwd:new URL('..',import.meta.url),timeout:120000});
 const result=JSON.parse(stdout);assert.ok(result.bytes>120*1024*1024);assert.ok(result.bytes>result.heapLimit);assert.equal(result.sections,2200);assert.equal(result.title,'Large draft');t.diagnostic(stdout.trim());
});
