import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {retainSearchVocabulary,verifySearchVocabulary} from '../src/record-search-vocabulary.js';
import {retainReferenceIndex,verifyReferenceIndex} from '../src/record-reference-index.js';
import {retainedQueryProjection} from '../src/record-query-projection.js';
import {digest,serialize} from '../src/storage-format.js';
import {sampleNotebook} from '../src/sample.js';
import {emptyAttempt} from '../src/web/attempt-model.js';
import {recordSearchText,recordReferenceTargets} from '../src/web/record-query.js';
import {preparation,event,assessment} from './fixtures/attempts.js';
const memory=()=>{const nodes=new Map();return {reads:0,writes:0,async put(kind,value){const text=serialize(value),revision=digest(text);assert.ok(Buffer.byteLength(text)<=65536);nodes.set(kind+':'+revision,text);this.writes++;return revision;},async read(kind,revision){this.reads++;return JSON.parse(nodes.get(kind+':'+revision));},tree(){return new RecordValueTree(this);}};};
const record=attempt=>({...sampleNotebook().entries[0],body:'',sections:[],contributors:[],attachments:[],figures:[],relations:[],tags:[],...(attempt?{attempt}:{})});
const ref=label=>({workspaceId:randomUUID(),kind:'record',id:randomUUID(),revision:'a'.repeat(64),label});
async function retain(document,previous){const vocabulary=await retainSearchVocabulary(document,{previous}),referenceIndex=await retainReferenceIndex(document,{previous});return {document,tree:document.tree,vocabulary,referenceIndex,...await retainedQueryProjection(document,'a'.repeat(64),{previous,searchText:vocabulary.text,referenceTargets:referenceIndex.root})};}
async function check(document,value){
 const original=await document.tree.read(document.root);assert.equal(await document.tree.read(value.vocabulary.text),recordSearchText(original));assert.deepEqual(await document.tree.read(value.referenceIndex.root),recordReferenceTargets(original));
 const fresh=await retain(document);await verifySearchVocabulary(document.blocks,value.vocabulary,document.blocks,fresh.vocabulary);await verifyReferenceIndex(document.blocks,value.referenceIndex,document.blocks,fresh.referenceIndex);
 const independent=await retainedQueryProjection(document,'a'.repeat(64));assert.deepEqual(await document.tree.read(value.root),await document.tree.read(independent.root));
}

test('appending run facts reuses earlier search text and every publication/reference contribution',async t=>{
 const measured=[];
 for(const count of [257,2003]){
  const blocks=memory(),p=preparation({protocols:[ref('Exact method')]}),shared=ref('Shared reference'),attempt={version:1,preparations:[p],events:Array.from({length:count},()=>event(p,{label:'Earlier observation',references:[shared]})),assessments:[assessment(p,0,{references:[ref('Retained conclusion')]})]};
  const document=new RecordDocument(blocks,await blocks.tree().retain(record(attempt)),{mutable:true}),prior=await retain(document),added=event(p,{label:'New zirconium observation 🌿',references:[shared,ref('Returned capture')]}),next=await document.splice(['attempt','events'],count,0,[added]);
  const field=next.field.bind(next),items=next.items.bind(next),reference=next.reference.bind(next);
  next.items=(path,options)=>{assert.notEqual(path[0],'attempt','Query enumerated prior history');return items(path,options);};
  next.field=(path,options)=>{if(path[0]==='attempt'&&path.length>=3)assert.ok(path[1]==='events'&&Number(path[2])===count,'Query read an earlier fact');return field(path,options);};
  next.reference=(path,options)=>{if(path[0]==='attempt'&&path.length>=3)assert.ok(path[1]==='events'&&Number(path[2])===count,'Query visited an earlier fact');return reference(path,options);};
  blocks.reads=blocks.writes=0;const result=await retain(next,prior);measured.push(blocks.reads);t.diagnostic(count+' earlier events: '+blocks.reads+' reads, '+blocks.writes+' writes');assert.ok(blocks.reads<5000);assert.ok(blocks.writes<400);
  next.field=field;next.items=items;next.reference=reference;await check(next,result);assert.equal(await document.tree.read(prior.vocabulary.text),recordSearchText(record(attempt)));
 }
 assert.ok(Math.abs(measured[1]-measured[0])<300,'Query work grew with earlier history');
});

test('run query text keeps exact empty seams, labels, correction history and earlier format identity',async()=>{
 const blocks=memory(),p=preparation({protocols:[ref('')]}),a=event(p,{label:'',circumstances:'𐀀',references:[ref(''),ref('Boundary 🌿')]}),b=assessment(p,0,{references:[a.references[1]]});let document=new RecordDocument(blocks,await blocks.tree().retain(record()),{mutable:true}),prior=await retain(document);
 for(const attempt of [emptyAttempt(),{...emptyAttempt(),preparations:[p]},{version:1,preparations:[p],events:[a],assessments:[b]}, {version:1,preparations:[p],events:[a,{...a,id:randomUUID(),supersedes:a.id,reason:'Correction',references:[]}],assessments:[b]},emptyAttempt(),undefined]){
  const next=attempt?await document.property([],'attempt',attempt):await document.property([],'attempt',undefined,{remove:true}),result=await retain(next,prior);await check(next,result);document=next;prior=result;
 }
 document=await document.property([],'attempt',{version:1,preparations:[p],events:[a],assessments:[b]});
 for(const version of [1,2]){
  const vocabulary=await retainSearchVocabulary(document,{version}),referenceIndex=await retainReferenceIndex(document,{version:1}),root=(await retainedQueryProjection(document,'a'.repeat(64),{searchText:vocabulary.text,referenceTargets:referenceIndex.root})).root;
  const old={document,tree:document.tree,root,vocabulary,referenceIndex},next=await document.splice(['attempt','events'],1,0,[event(p,{label:'Later observation'})]),result=await retain(next,old);await check(next,result);
  await verifySearchVocabulary(blocks,vocabulary,blocks,await retainSearchVocabulary(document,{version}));await verifyReferenceIndex(blocks,referenceIndex,blocks,await retainReferenceIndex(document,{version:1}));
 }
 await assert.rejects(retainSearchVocabulary(document,{signal:AbortSignal.abort()}),{name:'AbortError'});await assert.rejects(retainReferenceIndex(document,{signal:AbortSignal.abort()}),{name:'AbortError'});
});
