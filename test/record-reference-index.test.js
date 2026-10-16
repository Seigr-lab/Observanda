import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RetainedTableIndex} from '../src/retained-table-index.js';
import {retainReferenceIndex,verifyReferenceIndex,changedReferenceTerms} from '../src/record-reference-index.js';
import {recordReferenceTargets} from '../src/web/record-query.js';
import {researchReference} from '../src/web/research-reference.js';
import {referenceTerm} from '../src/record-search-terms.js';
import {digest,serialize} from '../src/storage-format.js';
import {attemptFixture} from './fixtures/attempts.js';
function memory(){const nodes=new Map();return {nodes,reads:0,writes:0,async put(kind,value){const text=serialize(value),revision=digest(text);assert.ok(Buffer.byteLength(text)<=65536);nodes.set(kind+':'+revision,text);this.writes++;return revision;},async read(kind,revision){this.reads++;return JSON.parse(nodes.get(kind+':'+revision));},tree(){return new RecordValueTree(this);}};}
const prose=targets=>({type:'doc',content:[{type:'paragraph',content:targets.map(target=>({type:'text',text:'Related',marks:[{type:'link',attrs:{href:researchReference(target),title:'',target:'_self',nofollow:false}}]}))}]});
const table=blocks=>new RetainedTableIndex(blocks,{namespace:'index',allowSparseBranches:true});
async function check(document,result){const record=await document.tree.read(document.root),expected=recordReferenceTargets(record);assert.deepEqual(await document.tree.read(result.root),expected);const terms=new Set((await Array.fromAsync(table(document.blocks).entries({root:result.terms}))).map(v=>v.id));assert.deepEqual(terms,new Set(expected.map(referenceTerm)));await verifyReferenceIndex(document.blocks,result,document.blocks,await retainReferenceIndex(document));}

test('reference contributions retain first-occurrence order and keep backlinks until the last independent mention is removed',async()=>{
 const blocks=memory(),workspaceId=randomUUID(),a={workspaceId,kind:'record',id:randomUUID()},b={workspaceId,kind:'record',id:randomUUID()},pinned={...a,revision:'a'.repeat(64)},record={body:prose([a,b,a]),sections:[{body:prose([b,a])},{body:prose([a])}],relations:[{type:'Method',target:a},{type:'Method',target:a},{type:'Pinned method',target:pinned}],attempt:attemptFixture()};
 let document=new RecordDocument(blocks,await blocks.tree().retain(record),{mutable:true}),before=await retainReferenceIndex(document);await check(document,before);
 for(const [path,value] of [[['relations'],record.relations.slice(1)], [['body'],'No mentions'], [['sections','0','body'],prose([a])], [['sections','1','body'],'Removed duplicate'], [['relations'],[]], [['sections'],[]], [['attempt'],null], [['body'],prose([b,pinned,a])], [['relations'],[{type:'New type',target:a}]], [['sections'],[{body:prose([a,b])}]]]){
  const next=path[0]==='attempt'&&value===null?await document.property([],'attempt',undefined,{remove:true}):await document.replace(path,value),after=await retainReferenceIndex(next,{previous:{document,referenceIndex:before}});await check(next,after);
  const oldTargets=recordReferenceTargets(await document.tree.read(document.root)),newTargets=recordReferenceTargets(await next.tree.read(next.root)),oldTerms=new Set(oldTargets.map(referenceTerm)),newTerms=new Set(newTargets.map(referenceTerm));
  assert.deepEqual(new Set(await Array.fromAsync(changedReferenceTerms(blocks,after,before))),new Set([...newTerms].filter(term=>!oldTerms.has(term))));assert.deepEqual(new Set(await Array.fromAsync(changedReferenceTerms(blocks,before,after))),new Set([...oldTerms].filter(term=>!newTerms.has(term))));
  assert.deepEqual(await document.tree.read(before.root),oldTargets);document=next;before=after;
 }
 await assert.rejects(retainReferenceIndex(document,{signal:AbortSignal.abort()}),{name:'AbortError'});
 const terms=table(blocks),first=await terms.entryAt({root:before.terms},0),bad=await terms.change(before.terms,first.id,'0'.repeat(64));await terms.flush(bad);
 await assert.rejects(verifyReferenceIndex(blocks,{...before,terms:bad},blocks,before),{code:'CATALOGUE_DAMAGED'});await assert.rejects(Array.fromAsync(changedReferenceTerms(blocks,{...before,terms:bad},before)),{code:'CATALOGUE_DAMAGED'});
 const raw=await document.tree.node(before.raw),entry=await table(blocks).entryAt({root:raw.root},0),saved=blocks.nodes.get('value:'+entry.revision);blocks.nodes.delete('value:'+entry.revision);await assert.rejects(verifyReferenceIndex(blocks,before,blocks,before));blocks.nodes.set('value:'+entry.revision,saved);
});

test('one early mention change does not inspect unrelated source text or renumber later reference values',async t=>{
 const measured=[];
 for(const count of [257,2003]){
  const blocks=memory(),workspaceId=randomUUID(),shared={workspaceId,kind:'record',id:randomUUID()},targets=Array.from({length:count},()=>({workspaceId,kind:'record',id:randomUUID()})),record={body:'',relations:[],sections:targets.map(target=>({body:prose([shared,target])}))};
  const document=new RecordDocument(blocks,await blocks.tree().retain(record),{mutable:true}),before=await retainReferenceIndex(document),next=await document.replace(['sections','0','body'],prose([targets[0]])),reference=next.reference.bind(next);
  next.reference=(path,flags)=>{if(path[0]==='sections'&&path.length>1)assert.equal(Number(path[1]),0,'Visited unchanged source prose');return reference(path,flags);};blocks.reads=blocks.writes=0;
  const after=await retainReferenceIndex(next,{previous:{document,referenceIndex:before}});measured.push(blocks.reads);t.diagnostic(count+' sections: '+blocks.reads+' reads and '+blocks.writes+' writes');assert.ok(blocks.reads<350);assert.ok(blocks.writes<30);
  assert.deepEqual((await next.tree.read(after.root)).slice(0,3),[{workspaceId,id:targets[0].id,type:'Mentioned in text'},{workspaceId,id:shared.id,type:'Mentioned in text'},{workspaceId,id:targets[1].id,type:'Mentioned in text'}]);
  next.reference=reference;await check(next,after);assert.deepEqual(await Array.fromAsync(changedReferenceTerms(blocks,after,before)),[]);assert.deepEqual(await Array.fromAsync(changedReferenceTerms(blocks,before,after)),[]);
 }
 assert.ok(Math.abs(measured[1]-measured[0])<100);
});
