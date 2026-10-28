import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {referenceBook} from './publication-reference-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {websitePreviewSource} from '../src/website-preview-source.js';
import {WebsiteSites} from '../src/website-sites.js';
import {workspaceSaveRequest} from '../src/web/workspace-edits.js';
import {ResearchRecords,recordRevision,recordRevisions} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {clearVault} from '../src/encryption.js';
import {renderPublication} from '../src/publication.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';

test('canvas reference windows reconcile saved and unsaved links without retaining every source record',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-canvas-references-')),book=referenceBook(600),target=book.entries[0];
 book.entries[300].share=false;delete book.entries[10].relations[0].role;book.entries[10].relations[0].target.revision='0'.repeat(64);
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const websitePin=(await new WebsiteSites(f.workspace).read(null)).websitePin,etag=(await f.workspace.outline()).etag,draft=structuredClone(book);draft.entries.splice(2,1);draft.entries.find(r=>r.id===book.entries[4].id).relations=[];
 const added={...structuredClone(book.entries[1]),id:randomUUID(),title:'Unsaved referring record'};draft.entries.push(added);
 const command={...workspaceSaveRequest(book,draft,recordRevisions(book)),baseEtag:etag},designTarget='entry:'+target.id;
 const read=ResearchCatalogue.prototype.record,query=ResearchCatalogue.prototype.queryDocuments;let bodies=[],summaries=0;
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return read.call(this,id,...args);};
 ResearchCatalogue.prototype.queryDocuments=async function*(...args){for await(const value of query.apply(this,args)){summaries++;yield value;}};
 t.after(()=>{ResearchCatalogue.prototype.record=read;ResearchCatalogue.prototype.queryDocuments=query;});
 const page=async(cursor=null,options={})=>{bodies=[];summaries=0;return (await websitePreviewSource(f.workspace,command,{websitePin,designTarget,referenceCursor:cursor,...options})).context;};
 const expected=draft.entries.slice(1).filter(r=>r.id!==book.entries[4].id&&r.id!==book.entries[10].id&&r.id!==book.entries[300].id&&r.id!==added.id).map(r=>r.id),seen=[],pages=[];let cursor=null;
 do{
  const context=await page(cursor);assert.ok(bodies.every(id=>[target.id,book.entries[2].id,book.entries[4].id].includes(id)));assert.equal(bodies.filter(id=>id===target.id).length,1);
  assert.ok(summaries<=55,summaries+' summaries');assert.ok(context.entryDestinations.length<=27);assert.ok(context.entries.length===1);seen.push(...context.referencePage.recordIds);pages.push({cursor,context});cursor=context.referencePage.nextCursor;
 }while(cursor);
 assert.deepEqual(seen,expected);assert.ok(!seen.includes(book.entries[300].id),'Website previews must exclude references without source consent');assert.ok(!seen.includes(added.id),'Unsaved originals cannot grant publication consent');
 let previous=pages.at(-1).context.referencePage.previousCursor;
 for(let i=pages.length-2;i>=0;i--){const context=await page(previous);assert.deepEqual(context.referencePage.recordIds,pages[i].context.referencePage.recordIds);previous=context.referencePage.previousCursor;}assert.equal(previous,null);
 const late=pages.at(-1),file='entries/'+target.id+'.html',render=context=>renderPublication(context,{designTarget,workspaceContent:true,singlePage:true}).files.get(file).replace(/references=[A-Za-z0-9_-]+/g,'references=CURSOR');
 const pinned=render(late.context);assert.throws(()=>renderPublication(late.context),{code:'INVALID'});
 const restyled=structuredClone(command);restyled.metadata.website??=structuredClone(book.website);restyled.metadata.website.footer='New unsaved footer';
 const styled=(await websitePreviewSource(f.workspace,restyled,{websitePin,designTarget,referenceCursor:late.cursor})).context;assert.deepEqual(styled.referencePage.recordIds,late.context.referencePage.recordIds);assert.match(render(styled),/New unsaved footer/);
 for(const bad of ['',42,'invalid',late.cursor.slice(0,-5)+'aaaaa'])await assert.rejects(page(bad),{code:'INVALID'});
 await assert.rejects(page(late.cursor,{designTarget:'entry:'+book.entries[1].id}),{code:'INVALID'});await assert.rejects(page(null,{signal:AbortSignal.abort()}),{name:'AbortError'});
 const other=Object.create(f.workspace);other.websiteId=randomUUID();await assert.rejects(websitePreviewSource(other,command,{websitePin,designTarget,referenceCursor:late.cursor}),{code:'NOT_FOUND'});
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:target.id,expectedRevision:recordRevision(target),record:{...target,title:'Later saved definition'}}]},{receipt:true});
 assert.equal(render(await page(late.cursor)),pinned);
 const access=await createAccess('','Synthetic canvas reference recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const destination=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'restored')),access,vault,f.vault),restored=new Workspace(destination,vault);let recovered=[],context;
 do{context=(await websitePreviewSource(restored,command,{websitePin,designTarget,referenceCursor:context?.referencePage.nextCursor??null})).context;recovered.push(...context.referencePage.recordIds);}while(context.referencePage.nextCursor);
 assert.deepEqual(recovered,seen);t.diagnostic(JSON.stringify({references:seen.length,windows:pages.length}));
});

test('sparse canvas windows continue past obsolete exact links without retaining their descriptors',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-canvas-sparse-')),book=referenceBook(300),target=book.entries[0];
 for(const row of book.entries.slice(1,285)){delete row.relations[0].role;row.relations[0].target.revision='0'.repeat(64);}
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const websitePin=(await new WebsiteSites(f.workspace).read(null)).websitePin,command={...workspaceSaveRequest(book,book,recordRevisions(book)),baseEtag:(await f.workspace.outline()).etag},designTarget='entry:'+target.id;
 const first=(await websitePreviewSource(f.workspace,command,{websitePin,designTarget})).context;assert.deepEqual(first.referencePage.recordIds,[]);assert.equal(first.referencePage.scanned,256);assert.ok(first.entryDestinations.length<=3);
 const next=(await websitePreviewSource(f.workspace,command,{websitePin,designTarget,referenceCursor:first.referencePage.nextCursor})).context;assert.deepEqual(next.referencePage.recordIds,book.entries.slice(285).map(r=>r.id));
 const prior=(await websitePreviewSource(f.workspace,command,{websitePin,designTarget,referenceCursor:next.referencePage.previousCursor})).context;assert.deepEqual(prior.referencePage.recordIds,[]);assert.equal(prior.referencePage.previousCursor,null);
});
