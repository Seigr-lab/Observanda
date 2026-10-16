import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordDocument} from '../src/record-document.js';
import {RetainedTableIndex} from '../src/retained-table-index.js';
import {retainSearchVocabulary,verifySearchVocabulary,changedSearchVocabulary} from '../src/record-search-vocabulary.js';
import {digest,serialize} from '../src/storage-format.js';
import {recordSearchText} from '../src/web/record-query.js';
import {documentTerms} from '../src/record-search-terms.js';
import {sampleNotebook} from '../src/sample.js';
import {attemptFixture} from './fixtures/attempts.js';
function memory(){const nodes=new Map();return {nodes,reads:0,writes:0,async put(kind,value){const raw=serialize(value),revision=digest(raw);assert.ok(Buffer.byteLength(raw)<=65536);nodes.set(kind+':'+revision,raw);this.writes++;return revision;},async read(kind,revision){this.reads++;return JSON.parse(nodes.get(kind+':'+revision));},tree(){return new RecordValueTree(this);}};}
const table=blocks=>new RetainedTableIndex(blocks,{namespace:'index',allowSparseBranches:true});
const vocabulary=async(blocks,value)=>new Set((await Array.fromAsync(table(blocks).entries({root:value.terms}))).map(entry=>entry.id));
const seed=()=>({...sampleNotebook().entries[0],title:'',body:'',outcome:'',sections:[],contributors:[],tags:[],relations:[],attachments:[],figures:[]});
async function check(document,value){const record=await document.tree.read(document.root),text=recordSearchText(record);assert.deepEqual(await vocabulary(document.blocks,value),documentTerms({searchText:text},1));if(value.version>=2){assert.equal((await Array.fromAsync(document.tree.text(value.text,[]))).join(''),text);assert.equal((await Array.fromAsync(document.tree.json(value.text,{canonical:true}))).join(''),JSON.stringify(text));}}

test('older vocabularies remain verifiable and upgrade without changing source values',async()=>{
 const blocks=memory(),record={...seed(),body:'Preserved 🌿 original',sections:[{id:randomUUID(),title:'Before',body:'Exact earlier evidence'}]},document=new RecordDocument(blocks,await blocks.tree().retain(record),{mutable:true});
 const before=await retainSearchVocabulary(document,{version:1}),expected=await retainSearchVocabulary(document,{version:1});await verifySearchVocabulary(blocks,before,blocks,expected);
 const next=await document.replace(['sections','0','title'],'Amended title'),upgraded=await retainSearchVocabulary(next,{previous:{document,vocabulary:before}});assert.equal(upgraded.version,3);await check(next,upgraded);await verifySearchVocabulary(blocks,upgraded,blocks,await retainSearchVocabulary(next));
 assert.deepEqual(await document.tree.read(document.root),record);await verifySearchVocabulary(blocks,before,blocks,expected);
 const textNode=await next.tree.node(upgraded.text),index=table(blocks),entry=await index.entryAt({root:textNode.root},0),wrong=await index.change(textNode.root,entry.id,await blocks.put('value',{type:'item',value:await next.tree.retain('Wrong association')}));await index.flush(wrong);
 const damaged={...upgraded,text:await blocks.put('value',{type:'joined-string',root:wrong})};await assert.rejects(verifySearchVocabulary(blocks,damaged,blocks,upgraded),{code:'CATALOGUE_DAMAGED'});
});

test('retained vocabulary equals complete text through empty-field seams, Unicode and source owners',async()=>{
 const blocks=memory(),record={...seed(),title:'Long α Σ',body:'A repeated 🌿 "observation" \\ value \ud800',outcome:'🌿',tags:['','x','', '\udfff'],sections:[{id:randomUUID(),title:'',body:''},{id:randomUUID(),title:'x',body:'y'}],contributors:[{id:randomUUID(),name:'',role:'a'}],template:{label:'',values:{a:'x',b:'',c:'long'}},attempt:attemptFixture(),results:{statements:[{title:'',text:'Result',limitations:'Limits'}]}};
 let document=new RecordDocument(blocks,await blocks.tree().retain(record),{mutable:true}),prior=await retainSearchVocabulary(document);await check(document,prior);
 for(const [path,value] of [[['title'],''],[['body'],''],[['outcome'],''],[['tags'],['']], [['tags'],[]], [['sections'],[]], [['contributors'],[]], [['template'],null], [['attempt'],null], [['results'],null], [['body'],'ab'],[['title'],'c'],[['tags'],['x','','','y']], [['tags'],['x','','y']], [['tags'],['\ud800','\ud801','\ufffd','\udfff','\udffd']], [['sections'],[{id:randomUUID(),title:'','body':'𐀀'}]]]){
  const next=await document.replace(path,value),result=await retainSearchVocabulary(next,{previous:{document,vocabulary:prior}}),fresh=await retainSearchVocabulary(next);
  await check(next,result);await verifySearchVocabulary(blocks,result,blocks,fresh);document=next;prior=result;
 }
});

test('one late text amendment touches changed contributors and preserves repeated terms across independent growth',async t=>{
 const measured=[];
 for(const size of [257,2003]){
  const blocks=memory(),record={...seed(),title:'Observations',body:'Shared repeated quartz',sections:Array.from({length:size},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Shared repeated quartz. '+('Constant evidence '.repeat(500))}))};
  const document=new RecordDocument(blocks,await blocks.tree().retain(record),{mutable:true}),before=await retainSearchVocabulary(document),position=size-2,next=await document.replace(['sections',String(position),'body'],'Changed zirconium observation');
  const original=next.field.bind(next);next.field=async(path,options)=>{if(path[0]==='sections'&&Number(path[1])!==position)throw Error('Read unchanged source prose');return original(path,options);};
  blocks.reads=blocks.writes=0;const after=await retainSearchVocabulary(next,{previous:{document,vocabulary:before}});measured.push(blocks.reads);t.diagnostic(size+' sections: '+blocks.reads+' block reads and '+blocks.writes+' writes');assert.ok(blocks.reads<3000);
  next.field=original;await check(next,after);await verifySearchVocabulary(blocks,after,blocks,await retainSearchVocabulary(next));
  const a=await vocabulary(blocks,before),b=await vocabulary(blocks,after);assert.deepEqual(new Set(await Array.fromAsync(changedSearchVocabulary(blocks,after,before))),new Set([...b].filter(v=>!a.has(v))));
  assert.deepEqual(new Set(await Array.fromAsync(changedSearchVocabulary(blocks,before,after))),new Set([...a].filter(v=>!b.has(v))));
 }
 assert.ok(measured[1]-measured[0]<200,'Changed vocabulary reads grew with unchanged record text');
});

test('reordering, removal, empty transitions and damaged counts cannot lose retained words',async()=>{
 const blocks=memory(),record={...seed(),sections:Array.from({length:80},(_,i)=>({id:randomUUID(),title:i%2?'':String(i),body:i%3?'Shared value':'Other value'}))};
 let document=new RecordDocument(blocks,await blocks.tree().retain(record),{mutable:true}),before=await retainSearchVocabulary(document);
 for(const sections of [[...record.sections].reverse(),record.sections.slice(4,30),[],record.sections]){
  const next=await document.replace(['sections'],sections),after=await retainSearchVocabulary(next,{previous:{document,vocabulary:before}});await check(next,after);await verifySearchVocabulary(blocks,after,blocks,await retainSearchVocabulary(next));document=next;before=after;
 }
 const index=table(blocks),first=(await index.entries({root:before.terms}).next()).value,root=await index.change(before.terms,first.id,'0'.repeat(64));await index.flush(root);
 await assert.rejects(verifySearchVocabulary(blocks,{...before,terms:root},blocks,before),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(Array.fromAsync(changedSearchVocabulary(blocks,{...before,terms:root},before)),{code:'CATALOGUE_DAMAGED'});
 for await(const entry of table(blocks).entries({root:before.parts})){
  const part=await blocks.read('value',entry.revision);if(!part.terms)continue;
  for(const key of ['value:'+entry.revision,'index:'+part.terms.hash]){const saved=blocks.nodes.get(key);blocks.nodes.delete(key);await assert.rejects(verifySearchVocabulary(blocks,before,blocks,before));blocks.nodes.set(key,saved);}break;
 }
 await assert.rejects(retainSearchVocabulary(document,{previous:{document,vocabulary:before},signal:AbortSignal.abort()}),{name:'AbortError'});
});
