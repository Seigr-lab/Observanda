import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {validateRecordDocument} from '../src/record-document-validation.js';
import {digest,serialize} from '../src/storage-format.js';
import {attemptFixture} from './fixtures/attempts.js';

async function fixture(count=19){
 const book=sampleNotebook(),record={...book.entries[2],sections:Array.from({length:count},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Exact observation '.repeat(20)})),attempt:attemptFixture()};
 const nodes=new Map(),blocks={reads:0,
  async put(kind,value){const text=serialize(value),hash=digest(text);nodes.set(kind+':'+hash,text);return hash;},
  async read(kind,hash){this.reads++;return JSON.parse(nodes.get(kind+':'+hash));},tree(){return new RecordValueTree(this);}};
 const document=new RecordDocument(blocks,await blocks.tree().retain(record),{mutable:true});
 await validateRecordDocument(document,book);return {book,record,document,blocks};
}
async function result(document,book,options){
 try{return {header:await validateRecordDocument(document,book,options)};}catch(error){if(error.code!=='INVALID')throw error;return {error:error.code};}
}

test('ordinary detail admission does not traverse previously admitted collections or run histories',async t=>{
 const measured=[];
 for(const count of [19,257,2003]){
  const f=await fixture(count),next=await f.document.replace(['status'],'in progress'),expected=await validateRecordDocument(next,f.book);
  next.items=async function*(){throw Error('An unchanged admitted collection was traversed');};f.blocks.reads=0;
  assert.deepEqual(await validateRecordDocument(next,f.book,{admitted:f.document}),expected);measured.push(f.blocks.reads);assert.ok(f.blocks.reads<1200,'Ordinary validation read '+f.blocks.reads+' blocks');
  t.diagnostic(`${count} unchanged sections: ${f.blocks.reads} block reads for ordinary-detail validation`);
 }
 assert.ok(Math.max(...measured)-Math.min(...measured)<100,'Validation grew with untouched sections');
});

test('reused validation preserves full admission for invalid details and changed owned values',async()=>{
 const f=await fixture(),first=f.record.sections[0],heading=id=>({type:'doc',content:[{type:'heading',attrs:{id,level:2},content:[{type:'text',text:'Repeated identity'}]}]});
 const cases=[
  [['title'],'Changed title'],[['title'],''],[['title'],'x'.repeat(181)],
  [['status'],'completed'],[['status'],'unexpected'],[['share'],false],[['share'],'yes'],
  [['occurredOn'],{kind:'unknown'}],[['occurredOn'],{kind:'day',value:'2026-02-31',estimated:false}],
  [['updatedAt'],'2026-10-11T14:00:00.000Z'],[['updatedAt'],'invalid'],
  [['body'],heading(first.id)],[['body'],'Changed narrative'],[['body'],'x'.repeat(60001)],
  [['sections','1','id'],first.id],[['sections','0','id'],f.book.id],[['sections','0','body'],heading(f.record.sections[1].id)],
  [['tags'],['x'.repeat(41)]],[['contributors'],[{id:randomUUID(),name:'',role:'Author'}]],
  [['figures'],[{id:randomUUID(),kind:'unknown'}]],[['attachments'],[{id:randomUUID(),kind:'unknown'}]],
  [['relations'],[{id:randomUUID(),type:'Uses',label:'Self',role:'uses-method',target:{workspaceId:f.book.id,kind:'record',id:f.record.id,revision:'a'.repeat(64)}}]],
  [['id'],first.id],[['notebookId'],randomUUID()],[['type'],'invalid'],
  [['attempt','events','1','id'],f.record.attempt.events[0].id],[['attempt','assessments','0','criterionId'],randomUUID()]
 ];
 for(const [path,value] of cases){
  const next=await f.document.replace(path,value),full=await result(next,f.book);
  assert.deepEqual(await result(next,f.book,{admitted:f.document}),full,path.join('.'));
 }
 for(const [name,value] of [['unexpected','property'],['outcome','A bounded result'],['outcome',42],['template',{fields:[],values:{}}],['results',{version:1,statements:[{id:randomUUID(),kind:'unknown'}]}]]){
  const next=await f.document.property([],name,value);assert.deepEqual(await result(next,f.book,{admitted:f.document}),await result(next,f.book),name);
 }
 const changed=await f.document.replace(['sections','0','title'],'Changed source'),items=changed.items;let visited=0;
 changed.items=async function*(...args){visited++;yield* items.apply(this,args);};await validateRecordDocument(changed,f.book,{admitted:f.document});assert.ok(visited>0,'Changed content skipped full collection validation');
 // Import/verification callers have no admitted source and always inspect it.
 const untouched=await f.document.replace(['status'],'in progress');untouched.items=async function*(){throw Error('Full admission reached collections');};
 await assert.rejects(validateRecordDocument(untouched,f.book),/Full admission reached collections/);
 const controller=new AbortController();controller.abort(Error('Stop validation'));await assert.rejects(validateRecordDocument(untouched,f.book,{admitted:f.document,signal:controller.signal}),/Stop validation/);
});
