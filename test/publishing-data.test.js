import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteSites} from '../src/website-sites.js';
import {WebsiteResearch} from '../src/website-research.js';
import {registerPublishingData} from '../src/web/publishing-data.js';

function provider(){const providers=new Map();registerPublishingData({register:value=>providers.set(value.id,value)});return providers.get('website');}

test('dashboard website counts resolve an explicit default website revision without opening the editor',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publishing-data-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const outline=await f.workspace.outline(),context={book:outline.metadata,etag:outline.etag,outline:true},sites=new WebsiteSites(f.workspace),research=new WebsiteResearch(f.workspace),calls=[];
 const api=async(route,data,options)=>{
  calls.push({route,data,options});
  if(route==='/api/websites/version')return sites.version(data.id);
  assert.equal(route,'/api/website/research/summary');return research.run('summary',data,options);
 };
 const signal=new AbortController().signal,count=await provider().load({context,api,signal});
 assert.equal(count,sampleNotebook().entries.filter(record=>record.share).length);
 assert.deepEqual(calls.map(call=>call.route),['/api/websites/version','/api/website/research/summary']);
 assert.deepEqual(calls[0].data,{id:null});
 assert.equal(calls[1].data.websitePin.researchSnapshotId,outline.etag);
 assert.equal(calls[1].data.websitePin.websiteId,null);
 assert.ok(calls[1].data.websitePin.websiteRevision);
 assert.ok(calls.every(call=>call.options.adopt===false&&call.options.signal===signal));
 assert.equal((await f.workspace.outline()).etag,outline.etag);
});

test('dashboard website counts reject mismatched owners, revisions and summary pins',async()=>{
 const context={book:{id:'00000000-0000-4000-8000-000000000001'},etag:'a'.repeat(64),outline:true},websitePin={researchSnapshotId:context.etag,websiteId:null,websiteRevision:'b'.repeat(64)};
 const version={workspaceId:context.book.id,etag:context.etag,websitePin},summary={workspaceId:context.book.id,snapshotId:context.etag,websitePin,entries:2};
 for(const invalid of [{...version,workspaceId:'other'},{...version,etag:'c'.repeat(64)},{...version,websitePin:{...websitePin,websiteId:context.book.id}},{...version,websitePin:{...websitePin,researchSnapshotId:'c'.repeat(64)}},{...version,websitePin:null}]){
  let calls=0;await assert.rejects(provider().load({context,api:async()=>{calls++;return invalid;}}));assert.equal(calls,1);
 }
 for(const invalid of [{...summary,websitePin:{...websitePin,websiteRevision:'c'.repeat(64)}},{...summary,entries:-1},{...summary,workspaceId:'other'},{...summary,snapshotId:'c'.repeat(64)}]){
  await assert.rejects(provider().load({context,api:async route=>route==='/api/websites/version'?version:invalid}));
 }
 assert.equal(await provider().load({context:{...context,outline:false},api:()=>{throw Error('Unexpected request');}}),null);
});
