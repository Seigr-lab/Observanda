import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {clearVault} from '../src/encryption.js';
import {materialReference} from '../src/web/material-reference.js';
import {withOperationProgress} from '../src/operation-progress.js';
import {materialRequest,executeMaterialRequest} from '../src/material-requests.js';

test('evidence pages and retained reads remain available while recursive dependency review is blocked',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-evidence-review-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),book=(await f.workspace.read()).book,recordId=book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 let source;const refs=[];
 await f.workspace.withLock(async()=>{
  source=await m.commit({kind:'collection',recordId,title:'Acquisition source',content:{inputs:[]}});
  for(let i=0;i<21;i++)refs.push(await m.commit({kind:'collection',recordId,title:'Interpretation '+i,content:{inputs:[source]}}));
  await m.commit({kind:source.kind,id:source.id,recordId,expectedRevision:source.revision,title:'Changed acquisition',content:{inputs:[]}});
 });
 const iterate=m.index.iterInputs.bind(m.index);m.index.iterInputs=()=>{throw Error('Overview started dependency traversal');};
 const one=await m.overview(recordId,{limit:1}),page=await m.overview(recordId,{limit:20});
 assert.equal(one.items.length,1);assert.equal(page.items.length,20);assert.ok(page.next);
 assert.ok(page.items.every(item=>item.dependencyStatus==='unchecked'&&item.changedCount===null&&item.changed.length===0));
 const overviewRequest=materialRequest('/api/research/materials/overview');
 assert.equal((await executeMaterialRequest(f.workspace,overviewRequest,{recordId},{sourceAccess:()=>{throw Error('Browsing requested dependency credentials');}})).items.length,20);
 let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 m.index.iterInputs=async function*(ref){entered();await gate;yield* iterate(ref);};
 const progress=[],pending=withOperationProgress(value=>progress.push(value),()=>m.reviewDependencies(recordId,{refs:[refs[0]]}));
 try{
  await started;
  assert.equal((await m.overview(recordId,{cursor:page.next,limit:20})).items.length,2);
  assert.equal((await m.read(refs[0])).title,'Interpretation 0');
 }finally{release();}
 const reviewed=await pending;assert.equal(reviewed.items[0].dependencyStatus,'checked');assert.equal(reviewed.items[0].changedCount,1);assert.equal(reviewed.items[0].changed[0].revision,source.revision);
 assert.ok(progress.some(value=>value.stage==='checking-evidence-references'&&value.completed===1));
 assert.ok(progress.some(value=>value.stage==='reviewing-evidence-dependencies'&&value.completed===1&&value.total===1));
 m.index.iterInputs=iterate;
 await f.workspace.withLock(()=>m.commit({kind:refs[0].kind,id:refs[0].id,recordId,expectedRevision:refs[0].revision,title:'Changed interpretation',content:{inputs:[]}}));
 const stale=(await m.reviewDependencies(recordId,{refs:[refs[0]]})).items[0];assert.equal(stale.dependencyStatus,'stale');assert.equal(stale.changedCount,null);
 const reviewRequest=materialRequest('/api/research/materials/dependency-review');assert.equal(reviewRequest.write,false);assert.equal(reviewRequest.progress,true);
 for(const data of [{recordId,refs:[...Array(51)].map(()=>refs[1])},{recordId,refs:[refs[1],refs[1]]},{recordId,refs:[{...refs[1],workspaceId:book.id}]},{recordId:book.entries[1].id,refs:[refs[1]]}])await assert.rejects(executeMaterialRequest(f.workspace,reviewRequest,data),{code:'MATERIAL_INVALID'});
 const controller=new AbortController();let checks=0;
 await assert.rejects(m.reviewDependencies(recordId,{refs:refs.slice(1,3).map(materialReference),signal:controller.signal,dependencyReview:async()=>{checks++;controller.abort();return {changed:[],changedCount:0,dependencyStatus:'checked'};}}),{name:'AbortError'});
 assert.equal(checks,1);assert.equal((await m.overview(recordId)).items.length,20);
});
