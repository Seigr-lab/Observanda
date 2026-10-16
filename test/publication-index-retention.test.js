import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {indexedBook} from './publication-index-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {contentBuffer} from '../src/file-content.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {collectionPagePath} from '../src/web/public-collection-pages.js';

test('retained static index continuation files survive a fresh-key backup and preserve their edition',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-index-edition-')),f=await encryptedFixture(directory,indexedBook(53)),releases=new PublicationJobs(f.workspace);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const candidate=await releases.inline({etag:(await f.workspace.outline()).etag}),names=['browse.html','browse-1.html','browse-2.html'],original=[];
 for(const [index,name]of names.entries()){const text=(await contentBuffer(candidate.files.get(name))).toString();original.push(text);assert.equal([...text.matchAll(/data-public-record=/g)].length,index===2?5:24);assert.ok(!text.includes('PRIVATE_RECORD_SENTINEL'));}
 const {metadata}=await f.workspace.outline();
 for(const target of ['project:'+metadata.projects[0].id,'notebook:'+metadata.notebooks[0].id])for(let index=0;index<3;index++){
  const name=collectionPagePath(target,index),text=(await contentBuffer(candidate.files.get(name))).toString();names.push(name);original.push(text);
  assert.equal([...text.matchAll(/data-record-id=/g)].length,index===2?5:24);assert.ok(!text.includes('PRIVATE_RECORD_SENTINEL'));
  assert.ok(text.includes('data-page="'+target+'"'));
 }
 const access=await createAccess('','another index installation password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const restored=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'restored')),access,vault,f.vault),jobs=new PublicationJobs(new Workspace(restored,vault));await jobs.verifyFiles(candidate.reviewId);const copy=await jobs.read(candidate.reviewId);assert.equal(copy.id,candidate.id);
 for(const [index,name]of names.entries())assert.equal((await contentBuffer(copy.files.get(name))).toString(),original[index]);
 assert.equal((await contentBuffer(copy.files.get('public-book.js'))).toString(),(await contentBuffer(candidate.files.get('public-book.js'))).toString());
});
