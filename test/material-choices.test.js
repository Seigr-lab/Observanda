import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {ObjectIndex} from '../src/object-index.js';
import {selectionBatch,selectionSize} from '../src/web/material-selection-pages.js';
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-source-choices-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),book=(await f.workspace.read()).book;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,m,directory,recordId:book.entries[0].id,other:book.entries[1].id};
}
const ref=item=>({kind:item.kind,id:item.id,revision:item.revision});
test('immutable choices preserve order and older revisions across removal, retries, restart and backup',async t=>{
 const f=await fixture(t),refs=[];
 for(let i=0;i<66;i++)refs.push(await f.m.collection({recordId:f.recordId,title:'Source '+i,inputs:[]}));
 let source={recordId:f.recordId,kind:null,selection:null,count:0};
 for(const reference of refs)source={...source,...await f.m.choices.change({...source,ref:reference,checked:true})};
 const original=source;
 const removed={...source,...await f.m.choices.change({...source,ref:refs[0],checked:false})};
 assert.equal(removed.count,65);assert.equal((await f.m.choices.page(original)).items[0].id,refs[0].id);
 const command={...removed,ref:refs[0],checked:true},first=await f.m.choices.change(command),retry=await f.m.choices.change(command);
 assert.equal(first.count,66);assert.deepEqual(await f.m.choices.page({...source,...first,offset:60}),await f.m.choices.page({...source,...retry,offset:60}));
 source={...source,...first};
 const final=(await f.m.choices.page({...source,offset:60})).items.map(ref);assert.deepEqual(final,[...refs.slice(61),refs[0]]);
 const originalDoc=await f.m.read(refs[1]);await f.m.collection({...originalDoc,expectedRevision:refs[1].revision,title:'Revised source',inputs:[]});
 assert.equal((await f.m.choices.page(source)).items[0].title,'Source 1');
 const flush=ObjectIndex.prototype.flush;
 ObjectIndex.prototype.flush=async function(root){await flush.call(this,root);if(this.namespace==='material-choice-index:')throw Object.assign(Error('Synthetic full disk'),{code:'ENOSPC'});};
 try{await assert.rejects(f.m.choices.change({...source,ref:refs[2],checked:false}),{code:'ENOSPC'});}finally{ObjectIndex.prototype.flush=flush;}
 assert.equal((await f.m.choices.page({...source,members:refs.slice(0,3)})).selected.length,3);
 await assert.rejects(f.m.choices.page({...source,recordId:f.other}),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.m.choices.page({...source,kind:'artifact'}),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.m.choices.page({...source,limit:65}),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.m.choices.page({...source,members:refs}),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.m.choices.change({...source,ref:{...refs[0],workspaceId:randomUUID()},checked:false}),{code:'MATERIAL_INVALID'});
 const bytes=Buffer.from(source.selection,'base64url');bytes[20]^=1;
 await assert.rejects(f.m.choices.page({...source,selection:bytes.toString('base64url')}),{code:'MATERIAL_INVALID'});
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copy,f.vault));
 assert.deepEqual(await restored.choices.page({...source,offset:60}),await f.m.choices.page({...source,offset:60}));
 const call=async(name,command)=>{assert.equal(name,'selection-page');return restored.choices.page(command);},method={kind:'record',id:randomUUID(),revision:'f'.repeat(64)};
 const extended={...source,extra:[method]};
 assert.equal(selectionSize(extended),67);assert.equal((await selectionBatch(call,extended,0)).length,64);
 assert.deepEqual(await selectionBatch(call,extended,64),[refs[65],refs[0],method]);
 const state=await restored.workspace.catalogue(store=>restored.choices.state(store,source));
 await restored.workspace.withLock(()=>restored.workspace.catalogue(store=>store.db.run('DELETE FROM state WHERE slot=$1','material-choice-index:'+state.root.hash)));
 await assert.rejects(restored.choices.page(source),{code:'CATALOGUE_DAMAGED'});
});

test('declared 246-file source selection and tenfold growth retain bounded handles and page reads',async t=>{
 const f=await fixture(t);let source={recordId:f.recordId,kind:null,selection:null,count:0},prior=null,peakHandle=0,peakHeap=0;
 const began=performance.now();let createMs=0,chooseMs=0;
 for(let i=0;i<2460;i++){
  assert.ok(performance.now()-began<360000,'Complete growth workload must remain within six minutes');const createStart=performance.now();
  const item=await f.m.collection({recordId:f.recordId,title:'Acquisition '+i,inputs:[],...(prior?{id:prior.id,expectedRevision:prior.revision}:{})});prior=item;createMs+=performance.now()-createStart;const chooseStart=performance.now();
  source={...source,...await f.m.choices.change({...source,ref:item,checked:true})};chooseMs+=performance.now()-chooseStart;
  peakHandle=Math.max(peakHandle,Buffer.byteLength(JSON.stringify(source)));peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);
  if(i===245||i===2459){
   const read=ObjectIndex.prototype.readNode;let reads=0,page;
   ObjectIndex.prototype.readNode=function(...args){reads++;return read.apply(this,args);};
   const start=performance.now();
   try{page=await f.m.choices.page({...source,offset:source.count-10,members:[item]});}finally{ObjectIndex.prototype.readNode=read;}
   assert.equal(page.items.length,10);assert.equal(page.selected.length,1);assert.equal(page.items.at(-1).title,'Acquisition '+i);
   assert.ok(reads<250,'Selected page read '+reads+' metadata objects');assert.ok(performance.now()-start<3000);
   assert.ok(peakHandle<1500);assert.ok(peakHeap<256*1024*1024);
   t.diagnostic(JSON.stringify({count:source.count,elapsedMs:Math.round(performance.now()-began),createMs:Math.round(createMs),chooseMs:Math.round(chooseMs),pageMs:Math.round(performance.now()-start),reads,peakHandle,sampledHeapMiB:Math.round(peakHeap/1024**2)}));
  }
 }
 assert.ok(performance.now()-began<360000);
});
