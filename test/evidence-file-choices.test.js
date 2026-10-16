import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {clearVault} from '../src/encryption.js';
import {ObjectIndex} from '../src/object-index.js';
import {compareEvidenceFiles} from '../src/web/evidence-files.js';
import {createFileSelection,fileSelectionPages,registerFileManifest,selectedFiles} from '../src/web/evidence-file-selection.js';
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-file-choices-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),book=(await f.workspace.read()).book;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const call=async(name,data)=>name==='intake-selection-append'?m.intakes.choices.append(data):name==='intake-selection-page'?m.intakes.choices.page(data):name==='intake-page'?m.intakes.page(data):m.intakes.append(data);
 return {...f,m,call,recordId:book.entries[0].id,other:book.entries[1].id};
}

test('directory selection and continuation match by relative location as well as bytes',async t=>{
 const f=await fixture(t),files=['tree/current/analysis.json','tree/historical/analysis.json','tree/preparation/analysis.json'].map(sourcePath=>{
  const file=new File(['{}'],'analysis.json');Object.defineProperty(file,'webkitRelativePath',{value:sourcePath});return file;
 });
 const source=await createFileSelection(f.call,f.recordId,files),items=[];for await(const page of fileSelectionPages(f.call,source))items.push(...page);
 assert.deepEqual(items.map(f=>f.sourcePath),files.map(f=>f.webkitRelativePath));
 const batch=await f.m.intakes.start({recordId:f.recordId,title:'Folder',count:3,bytes:6,sourceMode:'folder'});
 await registerFileManifest(f.call,batch,source);const moved=[...files];moved[0]=new File(['{}'],'analysis.json');
 const changed=await createFileSelection(f.call,f.recordId,moved);
 await assert.rejects(registerFileManifest(f.call,await f.m.intakes.read(batch.id).then(b=>f.m.intakes.summary(b)),changed),/differs/);
});
test('file selections retain exact duplicate acquisitions, sorted pages and interrupted manifests without browser arrays',async t=>{
 const f=await fixture(t),files=Array.from({length:75},(_,i)=>new File([String(i%7)],['a','A','ä','𐀀','\ue000'][i%5]+'.txt'));
 const source=await createFileSelection(f.call,f.recordId,files),items=[];
 for await(const page of fileSelectionPages(f.call,source)){assert.ok(page.length<=64);items.push(...page);}
 assert.deepEqual(items.map(v=>v.ordinal),[...items].sort((a,b)=>compareEvidenceFiles(a,b)||a.ordinal-b.ordinal).map(v=>v.ordinal));
 assert.equal(new Set(items.map(v=>v.ordinal)).size,75);
 const matches=[];for await(const item of selectedFiles(f.call,source,files))matches.push(await item.file.text());
 assert.deepEqual(matches,items.map(item=>String(item.ordinal%7)));
 let batch=await f.m.intakes.start({recordId:f.recordId,title:'Original recordings',count:75,bytes:75});
 batch=await f.m.intakes.append({id:batch.id,offset:0,items:items.slice(0,13)});
 const completed=await registerFileManifest(f.call,batch,source);assert.equal(completed.registered,75);
 assert.equal((await registerFileManifest(f.call,completed,source)).registered,75);
 const altered=[...files];altered[0]=new File(['z'],files[0].name);
 const changed=await createFileSelection(f.call,f.recordId,altered);
 await assert.rejects(registerFileManifest(f.call,completed,changed),/differs/);
 await assert.rejects(f.m.intakes.choices.page({...source,recordId:f.other}),{code:'MATERIAL_INVALID'});
 const bytes=Buffer.from(source.selection,'base64url');bytes[10]^=1;
 await assert.rejects(f.m.intakes.choices.page({...source,selection:bytes.toString('base64url')}),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.m.intakes.choices.page({...source,limit:65}),{code:'MATERIAL_INVALID'});
 const first={recordId:f.recordId,offset:0,items:items.slice(0,5)},saved=await f.m.intakes.choices.append(first),retry=await f.m.intakes.choices.append(first);
 assert.deepEqual(await f.m.intakes.choices.page({...saved,recordId:f.recordId}),await f.m.intakes.choices.page({...retry,recordId:f.recordId}));
 const flush=ObjectIndex.prototype.flush;
 ObjectIndex.prototype.flush=async function(root){await flush.call(this,root);if(this.namespace==='evidence-file-choice-index:')throw Object.assign(Error('Synthetic full disk'),{code:'ENOSPC'});};
 try{await assert.rejects(f.m.intakes.choices.append({...source,offset:75,items:items.slice(0,2)}),{code:'ENOSPC'});}finally{ObjectIndex.prototype.flush=flush;}
 assert.equal((await f.m.intakes.choices.page(source)).count,75);
 const newMaterials=new ResearchMaterials(f.workspace);assert.deepEqual(await newMaterials.intakes.choices.page(source),await f.m.intakes.choices.page(source));
 const state=await f.workspace.catalogue(store=>f.m.intakes.choices.state(store,source));
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('DELETE FROM state WHERE slot=$1','evidence-file-choice-index:'+state.root.hash)));
 await assert.rejects(f.m.intakes.choices.page(source),{code:'CATALOGUE_DAMAGED'});
});
test('246-file and tenfold selections retain bounded browser pages and authenticated index reads',async t=>{
 const f=await fixture(t);let source={recordId:f.recordId,selection:null,count:0,bytes:0},peakHandle=0;
 const begin=performance.now();
 for(let offset=0;offset<2460;){
  const end=offset<246?246:2460,items=Array.from({length:Math.min(64,end-offset)},(_,i)=>({name:'capture-'+String(3000-offset-i)+'.raw',size:1024*1024,fingerprint:(offset+i).toString(16).padStart(64,'0')}));
  source={recordId:f.recordId,...await f.m.intakes.choices.append({...source,offset,items})};offset+=items.length;
  peakHandle=Math.max(peakHandle,JSON.stringify(source).length);
  if(offset===246||offset===2460){
   let reads=0;const read=ObjectIndex.prototype.readNode;
   ObjectIndex.prototype.readNode=function(...args){reads++;return read.apply(this,args);};
   const pageStart=performance.now();let page;
   try{page=await f.m.intakes.choices.page({...source,offset:offset-64});}finally{ObjectIndex.prototype.readNode=read;}
   assert.equal(page.items.length,64);assert.ok(reads<120);assert.ok(performance.now()-pageStart<3000);assert.ok(peakHandle<1500);
   t.diagnostic(JSON.stringify({count:offset,elapsedMs:Math.round(performance.now()-begin),pageMs:Math.round(performance.now()-pageStart),reads,peakHandle}));
  }
 }
 assert.ok(performance.now()-begin<120000);
});
