import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordQuery} from '../src/record-query.js';
import {RecordSearchIndex} from '../src/record-search-index.js';
import {withRecordTerms,withChangedRecordTerms,recordTerms} from '../src/record-search-stream.js';
import {documentTerms} from '../src/record-search-terms.js';
import {recordQueryDocument,recordBrowse} from '../src/web/record-query.js';
import {queryTextMatches} from '../src/record-query-storage.js';

test('substring matching preserves chunk seams and verifies trailing data after a match',async()=>{
 for(const needle of ['bridge','🌿','\ud800','x','absent']){
  const text='x bridge 🌿 lone \ud800';
  for(let split=0;split<=text.length;split++)assert.equal(await queryTextMatches([text.slice(0,split),text.slice(split)],needle),text.includes(needle));
 }
 async function* corrupt(){yield 'found';throw Error('Invalid trailing block');}
 await assert.rejects(queryTextMatches(corrupt(),'found'),/Invalid trailing block/);
 const abort=new AbortController();abort.abort(Error('Cancelled'));
 await assert.rejects(queryTextMatches(['word'],'word',{signal:abort.signal}),/Cancelled/);
});

test('large private vocabulary spills exactly; matching and audits never assemble searchable text',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-search-stream-')),book=sampleNotebook();
 let vocabulary='';for(let i=0;i<3500;i++)vocabulary+=String.fromCharCode(0x4e00+i);
 const seed={...book.entries[0],type:'note',title:'Long field book',body:vocabulary+'x'.repeat(24000)+' a bridge 🌿 with "quotes" and \\ escapes',sections:[],attachments:[],figures:[],relations:[],contributors:[],tags:[]};
 seed.sections=Array.from({length:8},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Repeated observations. '.repeat(500)}));
 book.entries=[seed];const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const selected=RecordValueTree.prototype.selected;
 t.mock.method(RecordValueTree.prototype,'selected',function(root,path){if(path[0]==='searchText')throw Error('Loaded complete search text');return selected.call(this,root,path);});
 const expected=documentTerms(recordQueryDocument(seed),2);assert.ok(expected.size>8192);
 await f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,seed.id);t.mock.method(store,'record',()=>{throw Error('Loaded original record');});
  await withRecordTerms(store,row,snapshot.metadata,2,async bag=>assert.deepEqual(new Set(await Array.fromAsync(bag.items())),expected));
  await withChangedRecordTerms(store,row,snapshot.metadata,row,snapshot.metadata,2,async terms=>assert.deepEqual(await Array.fromAsync(terms),[]));
  await new RecordSearchIndex(store).verify(snapshot);
  let count=0;for await(const value of recordTerms(store,row,snapshot.metadata,2)){assert.ok(expected.has(value.term));count++;break;}assert.equal(count,1);
  const abort=new AbortController();abort.abort(Error('Cancelled'));
  await assert.rejects(withRecordTerms(store,row,snapshot.metadata,2,()=>assert.fail('Cancelled work consumed'),{signal:abort.signal}),/Cancelled/);
 });
 const query=new RecordQuery(f.workspace);
 for(const text of ['bridge 🌿','"quotes"','\\ escapes',vocabulary.slice(1000,1010),'absent phrase']){
  const result=await query.list({workspaceId:book.id,query:{projectId:null,notebookId:null,filter:'all',search:text,browse:recordBrowse()}});
  assert.equal(result.total,text==='absent phrase'?0:1);assert.ok(result.records.every(r=>!Object.hasOwn(r,'searchText')));
 }
});
