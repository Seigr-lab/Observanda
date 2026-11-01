import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {websitePreviewSource} from '../src/website-preview-source.js';
import {WebsiteSites} from '../src/website-sites.js';
import {publicationOwnerId} from '../src/publication-owner-identities.js';
import {workspaceSaveRequest} from '../src/web/workspace-edits.js';
import {recordRevisions} from '../src/research.js';
import {AppError} from '../src/errors.js';

test('one book canvas among many sources skips disconnected books and rechecks its selected grant',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-preview-demand-')),fixtures=[];
 t.after(async()=>{for(const f of fixtures)await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=upgradeNotebook(sampleNotebook());book.id=randomUUID();book.notebooks=book.notebooks.slice(0,1);book.projects=book.projects.filter(value=>value.id===book.notebooks[0].projectId);
 book.entries=[{...book.entries.find(value=>value.notebookId===book.notebooks[0].id),attachments:[],figures:[],sections:[],relations:[],share:true}];
 const source=await encryptedFixture(path.join(directory,'source'),book);fixtures.push(source);
 const host=upgradeNotebook(sampleNotebook());host.id=randomUUID();host.entries=[];host.projects=[];host.notebooks=[];host.website.home.sections=[];host.website.design.navigation='none';host.website.design.regions={definitions:[],assignments:[]};host.website.layouts=[];
 const local=await encryptedFixture(path.join(directory,'host'),host);fixtures.push(local);
 const site=await new WebsiteSites(local.workspace).read(null);Object.assign(host,site.book);const draft=structuredClone(host);
 const selected={workspaceId:book.id,labBookId:book.notebooks[0].id,projectIds:[book.projects[0].id],selection:{defaultShare:false,includeProjects:[book.projects[0].id],records:[]}};
 draft.website.researchSources=Array.from({length:99},()=>{const project=randomUUID();return {workspaceId:randomUUID(),labBookId:randomUUID(),projectIds:[project],selection:{defaultShare:false,includeProjects:[project],records:[]}};});draft.website.researchSources.splice(41,0,selected);
 const outline=await local.workspace.outline(),command={...workspaceSaveRequest(host,draft,recordRevisions(host)),baseEtag:outline.etag};
 let allowed=true,used=0,opened=0,closed=0;
 const sourceReader=async()=>{opened++;const admitted=new Set();return {
  async use(id,revision,consume){assert.equal(id,book.id,'An unrelated disconnected book was opened');if(!allowed)throw new AppError('ACCESS_LOCKED');used++;admitted.add(id);return source.workspace.catalogue(async store=>{const snapshot=await store.snapshot(revision);return {value:await consume(store,snapshot,{snapshotId:revision??await store.head(),owner:{workspaceId:book.id,projectId:book.projects[0].id,labBookId:book.notebooks[0].id},projectNamespaceId:book.id})};});},
  async verify(){if(admitted.size&&!allowed)throw new AppError('ACCESS_LOCKED');},async close(){closed++;}
 };};
 const target='notebook:'+publicationOwnerId(host.id,book.id,'notebook',book.notebooks[0].id),options={websitePin:site.websitePin,sourceReader};
 const page=await websitePreviewSource(local.workspace,command,{...options,designTarget:target});assert.equal(page.context.recordCards.length,1);assert.equal(page.editor.sources.length,1);assert.ok(used>0);assert.equal(opened,closed);
 allowed=false;await assert.rejects(websitePreviewSource(local.workspace,command,{...options,designTarget:target}),{code:'ACCESS_LOCKED'});assert.equal(opened,closed);
 const before=used,home=await websitePreviewSource(local.workspace,command,{...options,designTarget:'home'});assert.equal(used,before);assert.equal(home.editor.sources.length,0);assert.equal(opened,closed);
});
