import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {queryFixture} from './record-query-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordQuery} from '../src/record-query.js';
import {RecordFacetIndex} from '../src/record-facet-index.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {recordBrowse,recordQueryOrder} from '../src/web/record-query.js';
import {recordCounts} from '../src/web/record-workflow.js';

async function fixture(t){
 const temporaryRoot=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(temporaryRoot,'observanda-record-facets-')),book=queryFixture(),seed=book.entries.at(-1);
 for(let i=0;i<60;i++)book.entries.push({...structuredClone(seed),id:randomUUID(),title:'Additional '+i,occurredOn:i%4?'2026-06-01':{kind:'unknown'},sections:[],attachments:[],figures:[],relations:[]});
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),temporaryRoot);assert.ok(path.basename(directory).startsWith('observanda-record-facets-'));await rm(directory,{recursive:true,force:true});});
 return {...f,book,reader:new RecordQuery(f.workspace),query:{workspaceId:book.id,query:{projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse()},limit:7}};
}
test('record facets and indexed pages agree with complete scans before and after edits, deletion and historical reads',async t=>{
 const f=await fixture(t),original=await f.reader.list(f.query),ids=[],expected=[...f.book.entries].sort(recordQueryOrder());let page=original;
 assert.equal(original.total,expected.length);assert.deepEqual(original.counts,recordCounts(expected));assert.deepEqual(original.domains,['arts-creative','environmental-agricultural']);
 for(;;){ids.push(...page.records.map(value=>value.id));if(!page.nextCursor)break;const previous=page;page=await f.reader.list({...f.query,cursor:page.nextCursor});assert.deepEqual((await f.reader.list({...f.query,cursor:page.previousCursor})).records,previous.records);}
 assert.deepEqual(ids,expected.map(value=>value.id));
 const target=f.book.entries[2],records=new ResearchRecords(f.workspace,{}),changed={...target,title:'Changed date',occurredOn:'2030-01-01'};
 const saved=await records.save({workspaceId:f.book.id,changes:[{id:target.id,expectedRevision:recordRevision(target),record:changed}]},{recordIds:[target.id]});
 const current=await f.reader.list(f.query);assert.equal(current.records[0].id,target.id);assert.deepEqual(current.domains,original.domains);
 const retained=await f.reader.list({...f.query,snapshotId:original.snapshotId});assert.deepEqual(retained.records,original.records);assert.deepEqual(retained.domains,original.domains);assert.equal(retained.changed,true);
 await records.remove({workspaceId:f.book.id,recordId:target.id,expectedRevision:recordRevision(saved.book.entries[0])});const removed=await f.reader.list(f.query);assert.equal(removed.total,expected.length-1);assert.deepEqual(removed.domains,['arts-creative']);assert.deepEqual(removed.counts,recordCounts(expected.filter(value=>value.id!==target.id)));
 await f.workspace.catalogue(async store=>{const snapshot=await store.snapshot();await new RecordFacetIndex(store).verify(snapshot);});
});
test('older snapshots keep the scan fallback and the next successful write creates verified facets',async t=>{
 const f=await fixture(t),first=await f.reader.list(f.query);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const snapshot=await store.snapshot();delete snapshot.facetIndex;await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',first.snapshotId,snapshot),first.snapshotId);}));
 assert.deepEqual((await f.reader.list(f.query)).records,first.records);
 const target=f.book.entries[0];await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:target.id,expectedRevision:recordRevision(target),record:{...target,title:'After upgrade'}}]},{recordIds:[target.id]});
 await f.workspace.catalogue(async store=>{const current=await store.snapshot();assert.ok(current.facetIndex);await new RecordFacetIndex(store).verify(current);assert.equal((await store.snapshot(first.snapshotId)).facetIndex,undefined);});
});
test('an altered record facet branch cannot supply trusted counts',async t=>{
 const f=await fixture(t);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const snapshot=await store.snapshot(),slot='record-facet-index:'+snapshot.facetIndex.root.hash,row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),node=store.decode('state',slot,row.payload);node.revision='0'.repeat(64);await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,node),slot);}));
 await assert.rejects(f.reader.list(f.query),{code:'CATALOGUE_DAMAGED'});
});
