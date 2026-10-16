import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {referenceBook} from './publication-reference-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {appearancePreviewPage} from '../src/appearance-preview.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {clearVault} from '../src/encryption.js';
import {renderPublication} from '../src/publication.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';

test('high-degree references have bounded previews, direct late continuation, pinned identity and encrypted recovery',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reference-pages-')),book=referenceBook(600),target=book.entries[0];
 book.entries[300].share=false;
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const command={workspaceId:book.id,etag:(await f.workspace.outline()).etag,appearance:book.appearance,mode:'website'},file='entries/'+target.id+'.html';
 const original=ResearchCatalogue.prototype.record,decode=ResearchCatalogue.prototype.decode;let measuring=false,bodies=0,summaries=0;
 ResearchCatalogue.prototype.record=function(...args){if(measuring)bodies++;return original.apply(this,args);};
 ResearchCatalogue.prototype.decode=function(table,id,...args){if(measuring&&table==='state'&&id.startsWith('record-summary:'))summaries++;return decode.call(this,table,id,...args);};
 t.after(()=>{ResearchCatalogue.prototype.record=original;ResearchCatalogue.prototype.decode=decode;});
 const read=async(cursor=null)=>{bodies=0;summaries=0;measuring=true;try{return await appearancePreviewPage(f.workspace,command,file+(cursor?'?references='+encodeURIComponent(cursor):''));}finally{measuring=false;}};
 const pages=[],seen=[];let cursor=null;
 do{
  const context=await read(cursor);assert.ok(bodies<=1,bodies+' original reads');assert.ok(summaries<=85,summaries+' summaries');assert.ok(context.entryDestinations.length<=27);
  assert.ok(context.referencePage.recordIds.length<=24);seen.push(...context.referencePage.recordIds);pages.push({cursor,context});cursor=context.referencePage.nextCursor;
 }while(cursor);
 assert.deepEqual(seen,book.entries.slice(1).filter(r=>r.share).map(r=>r.id));
 const late=pages.at(-1);assert.ok(late.cursor);let previous=late.context.referencePage.previousCursor;
 for(let index=pages.length-2;index>=0;index--){const context=await read(previous);assert.deepEqual(context.referencePage.recordIds,pages[index].context.referencePage.recordIds);previous=context.referencePage.previousCursor;}assert.equal(previous,null);
 const comparable=context=>renderPublication(context,{emitBrowse:false}).files.get(file).replace(/references=[A-Za-z0-9_-]+/g,'references=CURSOR');
 const pinned=comparable(late.context);
 for(const bad of ['invalid',late.cursor.slice(0,-5)+'aaaaa'])await assert.rejects(read(bad),{code:'INVALID'});
 await assert.rejects(appearancePreviewPage(f.workspace,command,'entries/'+book.entries[1].id+'.html?references='+late.cursor),{code:'INVALID'});
 await assert.rejects(appearancePreviewPage(f.workspace,command,file,{signal:AbortSignal.abort()}),{name:'AbortError'});
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:target.id,expectedRevision:recordRevision(target),record:{...target,title:'New definition revision'}}]},{receipt:true});
 assert.equal(comparable(await read(late.cursor)),pinned);
 await assert.rejects(appearancePreviewPage(f.workspace,{...command,etag:(await f.workspace.outline()).etag},file+'?references='+late.cursor),{code:'INVALID'});
 const access=await createAccess('','synthetic reference recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const destination=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'restored')),access,vault,f.vault),restored=new Workspace(destination,vault);
 // A different encryption key creates different cursor bytes; follow its own
 // continuation and reconcile content, never copy an old key-bound cursor.
 let context=await appearancePreviewPage(restored,command,file),recovered=[];
 for(;;){recovered.push(...context.referencePage.recordIds);if(!context.referencePage.nextCursor)break;context=await appearancePreviewPage(restored,command,file+'?references='+context.referencePage.nextCursor);}
 assert.deepEqual(recovered,seen);t.diagnostic(JSON.stringify({references:seen.length,windows:pages.length,latePageOriginalReads:bodies,latePageSummaries:summaries}));
});

test('reference continuation makes progress through private and inapplicable link windows',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sparse-references-')),book=referenceBook(300),target=book.entries[0];
 for(const [index,entry]of book.entries.slice(1,285).entries()){
  if(index%3===0)entry.share=false;
  else{delete entry.relations[0].role;entry.relations[0].target.revision='0'.repeat(64);}
 }
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const command={workspaceId:book.id,etag:(await f.workspace.outline()).etag,appearance:book.appearance,mode:'website'},file='entries/'+target.id+'.html';
 const first=await appearancePreviewPage(f.workspace,command,file);assert.deepEqual(first.referencePage.recordIds,[]);assert.equal(first.referencePage.scanned,256);assert.ok(first.referencePage.nextCursor);
 const next=await appearancePreviewPage(f.workspace,command,file+'?references='+first.referencePage.nextCursor);assert.deepEqual(next.referencePage.recordIds,book.entries.slice(285).map(r=>r.id));assert.equal(next.referencePage.nextCursor,null);
 const prior=await appearancePreviewPage(f.workspace,command,file+'?references='+next.referencePage.previousCursor);assert.deepEqual(prior.referencePage.recordIds,[]);assert.equal(prior.referencePage.previousCursor,null);
});
