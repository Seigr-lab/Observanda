import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {PublicationOutputWriter,withPublicationOutputWriter,openPublicationOutput} from '../src/publication-output.js';
import {RetainedPublicationFiles,verifyPublicationCandidate} from '../src/retained-publication-files.js';
import {publicationFileRows} from '../src/publication-files.js';
import {contentBuffer} from '../src/file-content.js';
import {digest} from '../src/storage-format.js';
import {publicationWorkspace} from '../src/publication-pin.js';
import {catalogueFormat,catalogueRequiresPublicationDocuments} from '../src/catalogue-format.js';

test('output inventory binds nested retained blobs, selected choices and the exact streamed public manifest',{timeout:120000},async t=>{
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-output-')),book=sampleNotebook(),fixture=await encryptedFixture(root,book);
 t.after(async()=>{clearVault(fixture.vault);assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-output-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=publicationWorkspace(fixture.workspace),outline=await workspace.currentOutline(),job={id:randomUUID(),lease:{token:randomUUID()}},source={workspaceId:book.id,websiteId:null},releases=new PublicationJobs(workspace),directory=await releases.directory(job.id,job.lease.token);
 const late=randomUUID();
 const saved=await withPublicationOutputWriter(workspace,source,job,{directory},async writer=>{
 async function* home(){assert.equal(await workspace.catalogue(async store=>catalogueRequiresPublicationDocuments(await catalogueFormat(store.db))),true,'The first content is consumed only after older writers are excluded');yield '<!doctype html><title>Home</title>';await writer.retain('.nojekyll','');yield '<main>Retained website</main>';}
 await writer.retain('index.html',home());await writer.addChoice('pages','index.html',{path:'index.html',title:'Home'});
 await writer.retain('pages/'+late+'.html','<!doctype html><title>Late page</title>');await writer.addChoice('pages','pages/'+late+'.html',{path:'pages/'+late+'.html',title:'Late page'});
 await writer.retain('index.html',home());assert.equal(writer.count(),3);
 return writer.finish({defaultPage:'index.html'});
 });
 const stored={version:3,workspaceId:source.workspaceId,websiteId:null,websitePin:outline.websitePin,jobId:job.id,attempt:job.lease.token,reviewId:digest(job.id),etag:outline.etag,...saved,blockedValues:[]},files=await RetainedPublicationFiles.open(workspace,stored),candidate={...stored,files};
 await verifyPublicationCandidate(candidate);assert.equal(files.size,4);
 const output=await openPublicationOutput(workspace,stored),rows=[];for await(const row of publicationFileRows(workspace,stored))rows.push(row.file);assert.deepEqual(rows.map(row=>row.name),['.nojekyll','index.html','pages/'+late+'.html','publication.json']);assert.deepEqual(rows.slice(0,2).map(row=>row.index),[1,0]);
 assert.equal(await files.has('missing.html'),false);assert.equal(await files.get('missing.html'),undefined);assert.match((await contentBuffer(await files.get('index.html'))).toString(),/Retained website/);
 const manifest=JSON.parse((await contentBuffer(await files.get('publication.json'))).toString());assert.equal(manifest.releaseId,stored.id);assert.equal(manifest.files.length,3);assert.equal(manifest.files[0].path,'.nojekyll');
 const page=await releases.pageChoices(candidate,{path:'pages/'+late+'.html',limit:1});assert.equal(page.offset,1);assert.equal(page.items[0].title,'Late page');
 await assert.rejects(RetainedPublicationFiles.open(workspace,{...stored,attempt:randomUUID()}),{code:'JOB_DAMAGED'});
 await assert.rejects(output.window('pages',{cursor:(await output.window('files',{limit:1})).next}),{code:'INVALID'});
 await assert.rejects(withPublicationOutputWriter(workspace,source,job,{directory},writer=>writer.addChoice('pages','collision.html',{})),{code:'PUBLICATION_IDENTITY'});
 assert.match((await contentBuffer(await files.get('index.html'))).toString(),/Retained website/);
});

// Admission precedes both content consumption and indexed metadata writes.
// An older file workspace must continue using its supported legacy writer.
test('indexed outputs refuse legacy file storage and cancellation before consuming any content',async()=>{
 const job={id:randomUUID(),lease:{token:randomUUID()}},source={workspaceId:randomUUID(),websiteId:null};
 const workspace={root:path.join(os.tmpdir(),'observanda-output-admission'),storageKind:async()=> 'file',writeMetadata(){assert.fail('Unsupported metadata was written');},requireStorageKey(){assert.fail('Unsupported content was written');}};
 const writer=new PublicationOutputWriter(workspace,source,job,{directory:workspace.root});
 async function* content(){assert.fail('Unsupported content was consumed');yield 'unreachable';}
 await assert.rejects(writer.retain('index.html',content()),{code:'FORMAT'});
 await assert.rejects(writer.addChoice('pages','index.html',{path:'index.html',title:'Home'}),{code:'FORMAT'});
 const controller=new AbortController(),reason=new Error('Cancelled before admission');controller.abort(reason);
 const cancelled=new PublicationOutputWriter({...workspace,storageKind(){assert.fail('Cancelled admission touched storage');}},source,job,{directory:workspace.root,signal:controller.signal});
 await assert.rejects(cancelled.retain('index.html',content()),error=>error===reason);
});
