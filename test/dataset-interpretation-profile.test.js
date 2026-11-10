import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {executeMaterialRequest} from '../src/material-requests.js';
import {retainDatasetOriginal} from './fixtures/dataset-original.js';

test('native profile binds exact headings and numeral rules across ten originals and returns physical correction locations',async t=>{
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-profile-'));
 const book=sampleNotebook(),recordId=book.entries[0].id,f=await encryptedFixture(root,book);
 t.after(async()=>{await clearVault(f.vault);if(path.dirname(await realpath(root))===parent)await rm(root,{recursive:true,force:true});});
 const materials=new ResearchMaterials(f.workspace),mapping={format:'delimited',delimiter:',',header:true};
 const original=async(name,content)=>{const bytes=Buffer.from(content);return retainDatasetOriginal(materials,recordId,name,bytes.length,[bytes]);};
 const sample=await original('instrument.csv','run,counts,comment\nA,00031,baseline\n');
 const template=await materials.dataset({recordId,title:'Retained interpretation',artifact:sample,sourceMapping:mapping,
  columns:[defaultColumn({label:'Run ID'}),{...defaultColumn({label:'Counter'}),representation:'radix',radix:6,unit:'ticks',missing:[{value:'NA',meaning:'Unavailable'}]},defaultColumn({label:'Comment'})]});
 const proposal={recordId,id:randomUUID(),expectedRevision:null,title:'Instrument settings',template,
  rules:[{index:1,required:true,at:null,aliases:['ticks'],kinds:['string']},{index:2,required:false,at:null,aliases:[],kinds:null}]};
 const request=(operation,data)=>executeMaterialRequest(f.workspace,{material:operation},data,{signal:t.signal});
 const prepared=await request('dataset-profile-revision',{command:proposal,offset:0,limit:16});
 assert.equal(prepared.width,3);
 await assert.rejects(request('dataset-profile-save',{command:proposal,review:'0'.repeat(64)}),{code:'MATERIAL_CHANGED'});
 const {ref}=await request('dataset-profile-save',{command:proposal,review:prepared.review});
 assert.deepEqual((await request('dataset-profile-save',{command:proposal,review:prepared.review})).ref,ref);
 const cases=[
  ['A','run,counts,comment\nA,00031,ok\n',0],
  ['B','comment,counts,run\nok,31,B\n',0],
  ['C','run,comment\nC,missing\n',1],
  ['D','run,counts,comment\nD,60,invalid base six value\n',1],
  ['E','run,ticks,comment\nE,31,alias\n',0],
  ['F','run,counts\nF,NA\n',0],
  ['G','run,counts,extra\nG,0,keep me\n',0],
  ['H','run,counts,counts,comment\nH,1,2,ambiguous\n',2],
  ['I','run,counts,comment\nI,000000000000000000001,exact\n',0],
  ['J','run,counts,comment\n"J\nsecond line",3,quoted\nJ2,?,invalid\n',1]
 ];
 const checked=[];
 for(const [name,value,failures] of cases){
  const artifact=await original(name+'.csv',value);
  const result=await request('dataset-profile-review',{recordId,profile:ref,artifact,page:{}});
  assert.equal(result.failures,failures,name);
  checked.push({artifact,result});
  if(name==='B')assert.equal(result.columns.items[0].status,'reordered');
  if(name==='C')assert.equal(result.columns.items.find(item=>item.status==='missing-required').locator.line,1);
  if(name==='D')assert.deepEqual([result.issues.items[0].locator.line,result.issues.items[0].locator.column,result.issues.items[0].value.spelling],[2,1,'60']);
  if(name==='E')assert.equal(result.columns.items[1].status,'renamed');
  if(name==='F')assert.equal(result.examples.items[1].value.spelling,'NA');
  if(name==='G')assert.equal(result.examples.items[2].value.spelling,'keep me');
  if(name==='H')assert.equal(result.columns.items[1].status,'duplicate-source');
  if(name==='J')assert.equal(result.issues.items[0].locator.line,4);
  if(result.failures){assert.equal(result.review,null);continue;}
  const apply={id:randomUUID(),recordId,title:'Reviewed '+name,expectedRevision:null,artifact,sourceMapping:{format:'interpretation-profile'},interpretationProfile:{ref,review:result.review}};
  const retained=await materials.dataset(apply,{signal:t.signal});
  const output=await materials.read(retained);
  assert.deepEqual(output.content.inputs,[artifact,ref]);
  const preview=await materials.datasetPage(retained,0);
  if(name==='B')assert.deepEqual(preview.rows[0].cells,['ok','31','B']);
  if(name==='G')assert.equal(preview.columns[2].representation,'text');
  assert.equal(preview.columns[1].representation,'radix');
  assert.equal(preview.columns[1].radix,6);
 }
 const acquire=ResearchMaterials.prototype.artifact;
 let templateOpens=0;
 const spy=t.mock.method(ResearchMaterials.prototype,'artifact',async function(pinned,...args){
  if(pinned.id===sample.id)templateOpens++;
  return acquire.call(this,pinned,...args);
 });
 try{
  const selected=checked.slice(0,8);
  const batch=await request('dataset-profile-review-batch',{recordId,profile:ref,files:selected.map(({artifact},i)=>({ref:artifact,details:i===0}))});
  assert.equal(templateOpens,1);
  for(const [i,{result}] of selected.entries()){
   const {review,rowCount,failures}=result;
   assert.deepEqual(batch.items[i].report,i===0?result:{review,rowCount,failures});
  }
 }finally{spy.mock.restore();}
 assert.equal((await materials.current(ref.id)).revision,ref.revision);
 assert.equal((await materials.current(template.id)).revision,template.revision);
 const next={...proposal,expectedRevision:ref.revision,title:'Instrument v2',rules:proposal.rules.slice(1)};
 const difference=await request('dataset-profile-revision',{command:next,offset:0,limit:16});
 assert.deepEqual(difference.changes.items.map(item=>item.kind),['title','rule']);
 const second=await request('dataset-profile-save',{command:next,review:difference.review});
 assert.notEqual(second.ref.revision,ref.revision);
 assert.equal((await materials.read(ref)).title,'Instrument settings');
 await assert.rejects(request('dataset-profile-save',{command:proposal,review:prepared.review}),{code:'MATERIAL_CHANGED'});
});

test('large authored rules retain an ordinary portable original exactly once and replay the same reviewed revision',async t=>{
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-wide-rules-'));
 const book=sampleNotebook(),recordId=book.entries[0].id,f=await encryptedFixture(root,book);
 t.after(async()=>{await clearVault(f.vault);if(path.dirname(await realpath(root))===parent)await rm(root,{recursive:true,force:true});});
 const materials=new ResearchMaterials(f.workspace),names=Array.from({length:20},(_,i)=>'slot-'+i);
 const bytes=Buffer.from(names.join(',')+'\n'+names.map(()=>1).join(',')+'\n');
 const original=await retainDatasetOriginal(materials,recordId,'source.csv',bytes.length,[bytes]);
 const template=await materials.dataset({recordId,title:'Settings',artifact:original,columns:names.map(label=>defaultColumn({label}))});
 const rules=names.map((_,index)=>({index,at:null,required:true,kinds:['string'],
  aliases:Array.from({length:16},(_,n)=>'Signal '+index+' channel '+n+' '+'x'.repeat(80))}));
 const command={id:randomUUID(),recordId,title:'Bench profile',template,expectedRevision:null,rules};
 const request=(name,data)=>executeMaterialRequest(f.workspace,{material:name},data,{signal:t.signal});
 const {review}=await request('dataset-profile-revision',{command,offset:0,limit:1});
 const {ref}=await request('dataset-profile-save',{command,review});
 const doc=await materials.read(ref),inputs=(await materials.sequences.page(doc.content.inputsIndex,{limit:3})).items;
 assert.deepEqual(inputs.slice(0,2),[template,original]);assert.equal(inputs[2].kind,'artifact');
 const file=await materials.read(inputs[2]);assert.equal(file.content.sha256,JSON.parse(doc.content.parameters).rules.sha256);
 assert.deepEqual((await request('dataset-profile-read',{recordId,ref})).rules,rules);
 assert.deepEqual((await request('dataset-profile-save',{command,review})).ref,ref);
});

test('nested JSON matches qualified source pointers, distinguishes a missing path from null, and retains new input',async t=>{
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-profile-json-'));
 const book=sampleNotebook(),recordId=book.entries[0].id,f=await encryptedFixture(root,book);
 t.after(async()=>{await clearVault(f.vault);if(path.dirname(await realpath(root))===parent)await rm(root,{recursive:true,force:true});});
 const materials=new ResearchMaterials(f.workspace);
 const original=async(name,object)=>{const bytes=Buffer.from(JSON.stringify(object));return retainDatasetOriginal(materials,recordId,name,bytes.length,[bytes]);};
 const rowsPath='/runs/*/values',fields=[{name:'Reading',source:'row',path:'/reading'},{name:'Station',source:'context',path:'/runs/*/station'}];
 const mapping={format:'json-nested',rowsPath,joins:[],fields},wrap=(station,values)=>({runs:[{station,values}]});
 const reference=await original('base.json',wrap('A',[{reading:3}]));
 const template=await materials.dataset({recordId,title:'Nested readings',artifact:reference,sourceMapping:mapping,columns:fields.map(field=>defaultColumn({label:field.name}))});
 const rules=[{index:0,at:null,required:true,kinds:['number','null'],aliases:[]},{index:1,at:null,required:true,kinds:['string'],aliases:[],tokens:['A','B','C','D']}];
 const command={id:randomUUID(),recordId,title:'Nested run',template,expectedRevision:null,rules};
 const request=(op,data)=>executeMaterialRequest(f.workspace,{material:op},data,{signal:t.signal});
 const {review}=await request('dataset-profile-revision',{command,offset:0,limit:16});
 const {ref}=await request('dataset-profile-save',{command,review});
 const check=async(name,input)=>{
  const artifact=await original(name,input);
  return request('dataset-profile-review',{recordId,profile:ref,artifact,page:{}});
 };
 const ok=await check('extra.json',wrap('B',[{reading:null,station:'an unrelated field',note:'retain'}]));
 assert.equal(ok.failures,0);assert.equal(ok.examples.items[0].value.kind,'null');assert.equal(ok.examples.items[1].value.spelling,'B');
 assert.deepEqual(ok.columns.items.slice(2).map(x=>[x.identity.source,x.status]),[['row','unrecognized'],['row','unrecognized']]);
 const absent=await check('missing.json',wrap('C',[{display:'Reading'}]));
 assert.ok(absent.columns.items.some(x=>x.status==='missing-required'&&x.identity.path==='/reading'));
 assert.equal(absent.review,null);
 const changed=await check('changed.json',wrap('D',[{reading:'3'}]));
 assert.equal(changed.failures,1);assert.equal(changed.issues.items[0].reason,'unexpected-kind');
 assert.equal(changed.issues.items[0].locator.cellPointer,'/runs/0/values/0/reading');
 const stationChanged=await check('changed-station.json',wrap('V',[{reading:3}]));
 assert.deepEqual([stationChanged.failures,stationChanged.issues.items[0].reason,stationChanged.issues.items[0].value.spelling],[1,'unexpected-token','V']);
 assert.equal(stationChanged.issues.items[0].locator.cellPointer,'/runs/0/station');
});
