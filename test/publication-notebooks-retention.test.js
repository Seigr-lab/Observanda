import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {notebookDirectoryBook} from './publication-notebook-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {contentBuffer} from '../src/file-content.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {collectionPagePath} from '../src/web/public-collection-pages.js';
import {appearancePreviewPage} from '../src/appearance-preview.js';
import {renderPublication} from '../src/publication.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';

test('retained lab-book directories and preview preserve selection and survive encrypted recovery',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-books-edition-')),book=notebookDirectoryBook(),f=await encryptedFixture(directory,book),jobs=new PublicationJobs(f.workspace);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const etag=(await f.workspace.outline()).etag,candidate=await jobs.inline({etag}),target='project:'+book.notebooks[0].projectId;
 const first=(await contentBuffer(candidate.files.get(collectionPagePath(target)))).toString(),id=/class="project-book-directory"><div id="feed-([a-f0-9]+)"/.exec(first)[1],names=Array.from({length:3},(_,index)=>'projects/feed-'+id+'-'+index+'.html'),original=[];
 for(const [index,name]of names.entries()){
  const text=(await contentBuffer(candidate.files.get(name))).toString();original.push(text);assert.equal([...text.matchAll(/class="notebook-link"/g)].length,index===2?5:24);assert.ok(!text.includes('PRIVATE_BOOK_SENTINEL'));
 }
 const read=ResearchCatalogue.prototype.record,bodies=[];
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return read.call(this,id,...args);};
 try{
  const context=await appearancePreviewPage(f.workspace,{workspaceId:book.id,etag,appearance:book.appearance,mode:'website'},collectionPagePath(target)),preview=renderPublication(context,{emitBrowse:false});
  assert.deepEqual(bodies,[]);for(const [index,name]of names.entries()){
   const links=html=>[...html.matchAll(/class="notebook-link"><a href="([^"]+)"/g)].map(match=>match[1]);assert.deepEqual(links(preview.files.get(name)),links(original[index]));
  }
 }finally{ResearchCatalogue.prototype.record=read;}
 const access=await createAccess('','another installation password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const restored=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'restored')),access,vault,f.vault),restoredWorkspace=new Workspace(restored,vault),restoredJobs=new PublicationJobs(restoredWorkspace);
 await restoredJobs.verifyFiles(candidate.reviewId);const copy=await restoredJobs.read(candidate.reviewId);assert.equal(copy.id,candidate.id);
 for(const [index,name]of names.entries())assert.equal((await contentBuffer(copy.files.get(name))).toString(),original[index]);
 assert.equal((await restoredWorkspace.outline()).etag,etag);
});
