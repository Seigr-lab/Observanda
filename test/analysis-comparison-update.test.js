import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {ComparisonIndex} from '../src/analysis-comparison-index.js';
import {comparisonAccumulator,comparisonGroupKey} from '../src/analysis-comparison-accumulator.js';
import {digest,serialize} from '../src/storage-format.js';
const prefix='.observanda/materials/sequences/comparison-values/';
function fixture(){const objects=new Map(),reads=new Map(),workspace={readMetadata:async name=>{reads.set(name,(reads.get(name)??0)+1);return objects.get(name)??null;},writeMetadata:async(name,text)=>objects.set(name,text)},sequences=new MaterialSequence(workspace);return {objects,reads,workspace,sequences,index:new ComparisonIndex(sequences)};}
const counts=()=>({correct:0,mismatched:0,unresolved:0,unavailable:0,excluded:0});
const state=()=>({last:null,summary:{rows:0,raw:counts(),aggregate:counts(),runs:0,unknownRunRows:0,counts:{groups:0,distribution:0,transitions:0,observations:0}}});
const observation=row=>({source:0,page:0,row,investigation:null,run:null,calibration:null,condition:'Same condition',operation:'Recorded comparison',profile:'Declared profile',unit:'s',membership:'unspecified',window:'',windowRelation:'unknown',evidence:'raw',category:'correct',boundary:'inside',available:true,value:'7',exact:{numerator:'7',denominator:'1'},locator:{ref:{kind:'dataset',id:'11111111-1111-4111-8111-111111111111',revision:'a'.repeat(64)},selector:{kind:'cell',page:0,row,column:0}}});
async function priorFile(index,table,key){return prefix+(await index.tree.find({root:index.root},'lookup/'+table+'/'+digest(key))).revision+'.json';}

test('accumulation authenticates each existing group, distribution and transition once and preserves all indexed views',async()=>{
 for(const version of [1,2,3]){
  const f=fixture(),s=state(),append=comparisonAccumulator(f.index,s,{version,ordering:'source'});await append(observation(0));await append(observation(1));const old=await f.index.flush(),key=comparisonGroupKey(observation(0),version),distribution=JSON.stringify([key,'7/1','correct']),transition=JSON.stringify([JSON.stringify([0,key]),'correct','correct']),files=await Promise.all([['groups',key],['distribution',distribution],['transitions',transition]].map(([table,id])=>priorFile(f.index,table,id)));
  f.reads.clear();await append(observation(2));for(const file of files)assert.equal(f.reads.get(file),1,'Prior payload must be authenticated once: '+file);
  const root=await f.index.flush(),current=new ComparisonIndex(f.sequences,root),previous=new ComparisonIndex(f.sequences,old);assert.deepEqual(s.summary.counts,{groups:1,distribution:1,transitions:1,observations:3});assert.equal(s.summary.raw.correct,3);assert.deepEqual(s.last,{source:0,page:0,row:2,count:3});
  const group=(await current.page('groups')).items[0];assert.equal(group.rows,3);assert.equal(group.assessed,3);assert.equal(group.successful,3);assert.equal(group.boundaries.inside,3);assert.equal((await previous.page('groups')).items[0].rows,2);
  for(const [table,count]of [['distribution',3],['transitions',2]]){const row=(await current.page(table,{view:table,category:'correct',group:key})).items[0];assert.equal(row.count,count);assert.equal(row.locator?.selector.row??row.before.selector.row,0);}
  const rows=await current.page('observations',{view:'all',category:'correct',group:key});assert.deepEqual(rows.items.map(row=>row.locator.selector.row),[0,1,2]);assert.equal((await current.page('observations',{view:'exceptions',group:key})).total,0);assert.equal((await current.page('observations',{view:'boundary',group:key})).total,3);await current.verify();
 }
});

test('update rejects corrupted or mismatched authenticated predecessors without running the mutation',async()=>{
 for(const table of ['groups','distribution','transitions']){
  const f=fixture();await f.index.put(table,'wanted',{count:1},4);await f.index.flush();const root=f.index.root,file=await priorFile(f.index,table,'wanted'),original=f.objects.get(file);let called=false;
  f.objects.set(file,serialize({...JSON.parse(original),value:{count:9}}));await assert.rejects(f.index.update(table,'wanted',()=>{called=true;return {count:2};},999),{code:'MATERIAL_MISSING'});assert.equal(called,false);assert.equal(f.index.root,root);f.objects.set(file,original);
  // A valid content hash cannot make another key or table the prior value.
  for(const wrong of [{table,key:'other',ordinal:4,value:{count:1}},{table:'observations',key:'wanted',ordinal:4,value:{count:1}}]){const revision=await f.sequences.put('comparison-values',wrong),badRoot=await f.index.tree.change(root,'lookup/'+table+'/'+digest('wanted'),revision);f.index.root=badRoot;await assert.rejects(f.index.update(table,'wanted',()=>{called=true;return {count:2};},999),{code:'MATERIAL_MISSING'});assert.equal(called,false);assert.equal(f.index.root,badRoot);}
  f.index.root=root;assert.equal(await f.index.update(table,'wanted',prior=>({count:prior.count+1}),999),false);assert.equal((await f.index.get(table,'wanted')).ordinal,4);assert.equal((await f.index.get(table,'wanted')).value.count,2);
 }
});

test('an update bound to an old root cannot overwrite a newer mutation during authenticated reading or its callback',async()=>{
 for(const pauseAt of ['read','callback']){
  const f=fixture();await f.index.put('groups','wanted',{count:1},0);await f.index.flush();const file=await priorFile(f.index,'groups','wanted'),read=f.workspace.readMetadata;let release,entered,called=false;const held=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
  if(pauseAt==='read')f.workspace.readMetadata=async name=>{if(name===file){entered();await held;}return read(name);};
  const update=f.index.update('groups','wanted',async prior=>{called=true;if(pauseAt==='callback'){entered();await held;}return {count:prior.count+1};},0),rejected=assert.rejects(update,{code:'MATERIAL_CHANGED'});await ready;
  await f.index.put('observations','new',{id:'new'},0);const newer=f.index.root;release();await rejected;f.workspace.readMetadata=read;assert.equal(called,pauseAt==='callback');assert.equal(f.index.root,newer);assert.equal((await f.index.get('groups','wanted')).value.count,1);assert.equal((await f.index.get('observations','new')).value.id,'new');
 }
});

test('failed transformation or retained-value write leaves the published root retryable with no changed prior payload',async()=>{
 const f=fixture();await f.index.put('groups','wanted',{count:1},0);const root=await f.index.flush(),file=await priorFile(f.index,'groups','wanted'),original=f.objects.get(file);
 await assert.rejects(f.index.update('groups','wanted',prior=>{prior.count++;throw Error('Interrupted mutation');},0),/Interrupted mutation/);assert.equal(f.index.root,root);assert.equal(f.objects.get(file),original);
 const write=f.workspace.writeMetadata;f.workspace.writeMetadata=async(name,text)=>{if(name.startsWith(prefix))throw Object.assign(Error('Disk full'),{code:'STORAGE_FULL'});return write(name,text);};await assert.rejects(f.index.update('groups','wanted',prior=>({count:prior.count+1}),0),{code:'STORAGE_FULL'});assert.equal(f.index.root,root);f.workspace.writeMetadata=write;
 const reopened=new ComparisonIndex(f.sequences,root);await reopened.update('groups','wanted',prior=>({count:prior.count+1}),200);await reopened.flush();assert.equal((await reopened.get('groups','wanted')).value.count,2);assert.equal((await reopened.get('groups','wanted')).ordinal,0);assert.equal((await new ComparisonIndex(f.sequences,root).get('groups','wanted')).value.count,1);
});
