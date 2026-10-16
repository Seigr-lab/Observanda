import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {RecordHistory} from '../src/record-history.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {recordRevision} from '../src/research.js';
import {encrypted,clearVault} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {recordRevisionView,recordRevisionComparison} from '../src/web/record-revision-view.js';
const media={get:async()=>{throw Error('Unexpected attachment');}};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

test('record history reuses encrypted snapshots, omits other saves and restores only the reviewed record',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-record-history-')),vault=takeCreatedVault(await createAccess('','synthetic record history password')),ws=new Workspace(root,vault),history=new RecordHistory(ws,media);
 let saved=await ws.create(sampleNotebook());const original=structuredClone(saved.book.entries[0]),otherId=saved.book.entries[1].id,command={workspaceId:saved.book.id,recordId:original.id};
 const pin=await new ResearchMaterials(ws).pinRecord(original.id,recordRevision(original));
 const secondBook={id:randomUUID(),projectId:saved.book.projects[0].id,title:'Moved lab book'};saved.book.notebooks.push(secondBook);
 saved.book.entries[0].title='Changed record title';saved.book.entries[0].body='New interpretation';saved.book.entries[0].notebookId=secondBook.id;
 saved=await ws.save(saved.book,saved.etag);const newer=structuredClone(saved.book.entries[0]);
 saved.book.entries[1].title='Unrelated work';saved=await ws.save(saved.book,saved.etag);
 saved.book.description='New workspace description';saved=await ws.save(saved.book,saved.etag);
 const listing=await history.list(command);assert.equal(listing.versions.length,2);assert.equal(listing.versions[0].revision,recordRevision(newer));
 const old=listing.versions.find(v=>!v.current);
 assert.deepEqual((await history.read({...command,...old})).record,original);
 const before=structuredClone(saved.book);
 const restored=await history.restore({...command,...old,expectedRevision:listing.currentRevision});
 assert.equal(restored.book.entries[0].title,original.title);assert.equal(restored.book.entries[0].body,original.body);
 assert.equal(restored.book.entries[0].notebookId,secondBook.id);assert.equal(restored.book.entries[0].share,false);
 assert.equal(restored.book.entries[0].createdAt,newer.createdAt);
 assert.equal(restored.book.description,before.description);assert.deepEqual(restored.book.projects,before.projects);assert.deepEqual(restored.book.notebooks,before.notebooks);
 assert.deepEqual(restored.book.entries.find(e=>e.id===otherId),before.entries.find(e=>e.id===otherId));
 assert.equal((await history.list(command)).versions.length,3);
 assert.deepEqual(await new ResearchMaterials(ws).read(pin),original);
 await ws.catalogue(async store=>{const snapshot=(await store.db.get('SELECT payload FROM snapshots WHERE id=$1',old.source.id));assert.ok(encrypted(Buffer.from(snapshot.payload)));});
 // An unrelated save during review does not make this record's restore stale.
 let after=await ws.read();after.book.entries[1].title='Concurrent unrelated edit';after=await ws.save(after.book,after.etag);
 const latest=await history.list(command),target=latest.versions.find(v=>v.revision===recordRevision(newer));
 const redone=await history.restore({...command,...target,expectedRevision:latest.currentRevision});
 assert.equal(redone.book.entries[1].title,'Concurrent unrelated edit');assert.equal(redone.book.entries[0].title,newer.title);
 clearVault(vault);await assert.rejects(history.list(command),{code:'ACCESS_LOCKED'});
});

test('record restore rejects stale review, forged revisions and damaged history without changing data',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-record-conflict-')),ws=new Workspace(root),history=new RecordHistory(ws,media);
 let saved=await ws.create(sampleNotebook());const command={workspaceId:saved.book.id,recordId:saved.book.entries[0].id};
 saved.book.entries[0].title='Version two';saved=await ws.save(saved.book,saved.etag);
 const listing=await history.list(command),old=listing.versions.find(v=>!v.current);
 saved.book.entries[0].body='Concurrent same-record edit';saved=await ws.save(saved.book,saved.etag);
 await assert.rejects(history.restore({...command,...old,expectedRevision:listing.currentRevision}),{code:'RECORD_CHANGED'});
 await assert.rejects(history.restore({...command,...old,revision:'0'.repeat(64),expectedRevision:recordRevision(saved.book.entries[0])}),{code:'RECORD_HISTORY_MISSING'});
 await assert.rejects(history.read({...command,...old,source:{kind:'workspace',id:'../observanda'}}),{code:'INVALID'});
 await assert.rejects(history.list({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 assert.equal((await ws.read()).etag,saved.etag);
 const file=path.join(root,'.observanda','revisions',old.source.id+'.json');await writeFile(file,(await readFile(file,'utf8'))+' ');
 await assert.rejects(history.restore({...command,...old,expectedRevision:recordRevision(saved.book.entries[0])}),{code:'FORMAT'});
 assert.equal((await ws.read()).etag,saved.etag);
});

test('historical record presentation includes custom values, figure changes and safely escaped writing',()=>{
 const record=sampleNotebook().entries[0];record.body='<script>private literal prose</script>';
 record.template={label:'Material study',fields:[{key:'pigment',label:'Pigment'}],values:{pigment:'Ochre'}};
 const html=recordRevisionView(record,esc);assert.ok(html.includes('Ochre'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
 const current=structuredClone(record);current.tags=['review'];current.template.values.pigment='Indigo';current.figures=[];
 const comparison=recordRevisionComparison(record,current,esc);
 assert.ok(comparison.includes('Tags'));assert.ok(comparison.includes('Indigo'));assert.ok(comparison.includes('Ochre'));assert.ok(comparison.includes('Figures'));
});
