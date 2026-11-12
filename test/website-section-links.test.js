import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {WebsiteResearch} from '../src/website-research.js';
import {WebsiteSites} from '../src/website-sites.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordDocument} from '../src/record-document.js';

test('section destinations page pinned headings without full record or prose reads',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-section-destinations-')),book=sampleNotebook(),record=book.entries[0];record.sections=Array.from({length:57},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Retained evidence '+i}));
 const f=await encryptedFixture(root,book);t.after(async()=>{await clearVault(f.vault);await rm(root,{recursive:true,force:true});});const outline=await f.workspace.outline(),base={workspaceId:book.id,snapshotId:outline.etag,websitePin:(await new WebsiteSites(f.workspace).read(null)).websitePin,recordId:record.id};
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Full record read');});const selected=RecordDocument.prototype.field,paths=[];
 t.mock.method(RecordDocument.prototype,'field',function(path,...args){paths.push(path);assert.ok(['id','title'].includes(path.at(-1)));return selected.call(this,path,...args);});
 const service=new WebsiteResearch(f.workspace),first=await service.run('sections',{...base,offset:0}),second=await service.run('sections',{...base,offset:first.next}),last=await service.run('sections',{...base,offset:second.next});
 assert.equal(first.total,57);assert.equal(first.items.length,25);assert.equal(second.items[0].title,'Section 25');assert.equal(last.items.length,7);assert.equal(last.next,null);assert.equal(last.previous,25);assert.equal(new Set([...first.items,...second.items,...last.items].map(item=>item.id)).size,57);assert.equal(paths.length,3);assert.ok(paths.every(path=>path.length===1&&path[0]==='id'),'Only owner identity reads; section labels come from the bounded query index');
 assert.deepEqual((await service.run('sections',{...base,offset:last.previous})).items,second.items);
 await assert.rejects(service.run('sections',{...base,offset:1}),{code:'INVALID'});await assert.rejects(service.run('sections',{...base,offset:75}),{code:'INVALID'});await assert.rejects(service.run('sections',{...base,workspaceId:randomUUID(),offset:0}),{code:'WORKSPACE_CHANGED'});
 const aborted=new AbortController();aborted.abort();await assert.rejects(service.run('sections',{...base,offset:0},{signal:aborted.signal}),{name:'AbortError'});
});
