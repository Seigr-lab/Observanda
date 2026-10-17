import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {WebsiteSites} from '../src/website-sites.js';
import {WorkspaceEdits} from '../src/workspace-edits.js';
import {clearVault} from '../src/encryption.js';

test('research edit and restore boundaries preserve independent website content and consent',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-boundary-')),original=sampleNotebook(),f=await encryptedFixture(directory,original),sites=new WebsiteSites(f.workspace);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const legacy=await f.workspace.catalogue(async store=>{for(const id of await store.snapshots())if(!(await store.snapshot(id)).websiteDocuments)return id;throw Error('Missing retained inline snapshot');});
 const site=await sites.read(null),recordId=original.entries[0].id;
 const saved=await sites.save(null,{workspaceId:original.id,baseEtag:site.etag,websitePin:site.websitePin,metadata:{website:{...site.book.website,footer:'Independent footer'}},projects:[],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[],records:[{id:recordId,share:false,attachments:[]}]}});
 const current=await f.workspace.read();
 await assert.rejects(new WorkspaceEdits(f.workspace,{}).save({workspaceId:original.id,baseEtag:current.etag,response:'outline',metadata:{},projects:[],changes:[],removed:[],selection:{includeProjects:[],records:[{id:recordId,share:!original.entries[0].share,attachments:[]}]}}),{code:'INVALID'});
 assert.equal((await f.workspace.outline()).etag,current.etag);
 const book=structuredClone(current.book);book.entries[0].body='Later research body';await f.workspace.save(book,current.etag);
 await f.workspace.restore(legacy,(await f.workspace.outline()).etag);
 const restored=await f.workspace.read(),after=await sites.read(null);
 assert.equal(restored.book.entries.find(r=>r.id===recordId).body,original.entries[0].body);
 assert.equal(restored.book.entries.find(r=>r.id===recordId).share,original.entries[0].share);
 assert.equal(after.book.website.footer,'Independent footer');assert.deepEqual(after.site.selection,saved.site.selection);assert.equal(after.websitePin.websiteRevision,saved.websitePin.websiteRevision);
});
