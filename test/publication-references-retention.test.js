import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {referenceBook} from './publication-reference-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {contentBuffer} from '../src/file-content.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';

test('retained reference continuation files restore byte for byte under a fresh encryption key',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reference-edition-')),book=referenceBook(),f=await encryptedFixture(directory,book),jobs=new PublicationJobs(f.workspace);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const etag=(await f.workspace.outline()).etag,candidate=await jobs.inline({etag}),names=[...candidate.files.keys()].filter(name=>name.startsWith('entries/references-'+book.entries[0].id+'-'));
 assert.equal(names.length,2);const original=await Promise.all(names.map(async name=>(await contentBuffer(candidate.files.get(name))).toString()));
 const access=await createAccess('','reference edition restore'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const destination=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'restored')),access,vault,f.vault),restored=new PublicationJobs(new Workspace(destination,vault));
 await restored.verifyFiles(candidate.reviewId);const copy=await restored.read(candidate.reviewId);assert.equal(copy.id,candidate.id);
 for(const [index,name]of names.entries())assert.equal((await contentBuffer(copy.files.get(name))).toString(),original[index]);
});
