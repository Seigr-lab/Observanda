import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordBlockStore} from '../src/record-block-store.js';
import {withChangedRecordTerms,withRecordTerms} from '../src/record-search-stream.js';
import {documentTerms,referenceTerm} from '../src/record-search-terms.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-search-changes-')),book=sampleNotebook();book.entries=book.entries.slice(0,1);
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});return {...f,book,record:book.entries[0]};
}
const target=workspaceId=>({workspaceId,id:randomUUID(),type:'Mentioned in text'});
const difference=(own,other,version)=>{const opposite=documentTerms(other,version);return new Set([...documentTerms(own,version)].filter(term=>!opposite.has(term)));};
const changed=(store,row,other,version=2,options={})=>withChangedRecordTerms(store,row,{},other,{},version,async terms=>new Set(await Array.fromAsync(terms)),options);
async function retain(store,record,value){
 const query={id:record.id,notebookId:record.notebookId,...value};
 return {...record,...await new RecordQueryDocuments(store).retainValues(record.id,query,{id:query.id,notebookId:query.notebookId})};
}

test('changed search domains preserve exact differences for inline, retained and legacy query sources',async t=>{
 const f=await fixture(t),a=target(f.book.id),b=target(f.book.id),c=target(f.book.id);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  for(const padding of ['', 'preserved field observations '.repeat(3000)]){
   const base={searchText:padding+'a bridge 🌿 \ud800 with 123.456',referenceTargets:[a,a,b]},before=await retain(store,f.record,base);
   for(const amendment of [
    {status:'completed'}, {searchText:padding+'a changed 🌱 \ud800 with 123.456'},
    {referenceTargets:[a,c,c]}, {searchText:padding+'both changed',referenceTargets:[]},
    {searchText:'',referenceTargets:[c]}, {referenceTargets:[b,a]}
   ]){
    const next={...base,...amendment},after=await retain(store,f.record,next);
    for(const version of [1,2]){
     assert.deepEqual(await changed(store,after,before,version),difference(next,base,version));
     assert.deepEqual(await changed(store,before,after,version),difference(base,next,version));
     assert.deepEqual(await changed(store,after,null,version),documentTerms(next,version),'Insert/move path enumerates all terms');
    }
   }
  }
  const legacy={id:f.record.id,notebookId:f.record.notebookId,searchText:'legacy bridge',referenceTargets:[a]},newer={...legacy,searchText:'retained bridge',referenceTargets:[b]};
  const after=await retain(store,f.record,newer),before={id:f.record.id,notebookId:f.record.notebookId};
  t.mock.method(store,'queryDocuments',async function*(){yield legacy;});
  for(const version of [1,2]){
   assert.deepEqual(await changed(store,after,before,version),difference(newer,legacy,version));
   assert.deepEqual(await changed(store,before,after,version),difference(legacy,newer,version));
  }
 }));
});

test('unchanged search domains use fixed work as prose and linked-record collections grow',async t=>{
 const f=await fixture(t),measurements=[];
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  for(const [bytes,count] of [[131072,257],[1048576,2003]]){
   const base={searchText:'x'.repeat(bytes)+' tail 🌿',referenceTargets:Array.from({length:count},()=>target(f.book.id))},before=await retain(store,f.record,base),after=await retain(store,f.record,{...base,status:'completed'});
   const read=RecordBlockStore.prototype.read,text=RecordValueTree.prototype.text,page=RecordValueTree.prototype.page;let reads=0,allowText=false,allowReferences=false;
   t.mock.method(RecordBlockStore.prototype,'read',function(...args){reads++;return read.apply(this,args);});
   t.mock.method(RecordValueTree.prototype,'text',function(...args){assert.ok(allowText,'Unchanged text was enumerated');return text.apply(this,args);});
   t.mock.method(RecordValueTree.prototype,'page',function(root,path,...args){if(path[0]==='referenceTargets')assert.ok(allowReferences,'Unchanged references were enumerated');return page.call(this,root,path,...args);});
   assert.deepEqual(await changed(store,after,before),new Set());measurements.push(reads);assert.ok(reads<150,'Unchanged domains read '+reads+' blocks');t.diagnostic(`${bytes} text characters / ${count} references: ${reads} block reads`);
   const fresh=target(f.book.id),linked=await retain(store,f.record,{...base,referenceTargets:[...base.referenceTargets,fresh]});allowReferences=true;
   assert.deepEqual(await changed(store,linked,before),new Set([referenceTerm(fresh)]));assert.deepEqual(await changed(store,before,linked),new Set());allowReferences=false;
   const edited={...base,searchText:base.searchText+' amendment'},changedText=await retain(store,f.record,edited);allowText=true;
   assert.deepEqual(await changed(store,changedText,before),difference(edited,base,2));assert.deepEqual(await changed(store,before,changedText),difference(base,edited,2));
   RecordBlockStore.prototype.read.mock.restore();RecordValueTree.prototype.text.mock.restore();RecordValueTree.prototype.page.mock.restore();
  }
 }));
 assert.ok(Math.abs(measurements[1]-measurements[0])<10,'Unchanged search work grew with text/references');
});

test('changed search admission checks field types, ownership and cancellation even when sources match',async t=>{
 const f=await fixture(t);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  for(const padding of ['', 'retained padding '.repeat(5000)]){
   for(const fields of [{referenceTargets:[]},{searchText:42,referenceTargets:[]},{searchText:'valid',referenceTargets:{}},{searchText:{body:'not text'},referenceTargets:[]}]){
    const row=await retain(store,f.record,{padding,...fields});await assert.rejects(changed(store,row,row),{code:'CATALOGUE_DAMAGED'});
   }
  }
  const row=await retain(store,f.record,{searchText:'valid',referenceTargets:[]}),other={...row,notebookId:randomUUID()};
  await assert.rejects(changed(store,row,other),{code:'CATALOGUE_DAMAGED'});await assert.rejects(changed(store,other,row),{code:'CATALOGUE_DAMAGED'});
  const abort=new AbortController();abort.abort(Error('Cancelled search change'));await assert.rejects(changed(store,row,row,2,{signal:abort.signal}),/Cancelled search change/);
  const missingReferences=await retain(store,f.record,{searchText:'legacy optional references'});assert.deepEqual(await changed(store,missingReferences,missingReferences),new Set());
  const retainedMissing=await retain(store,f.record,{searchText:'z'.repeat(70000)});await assert.rejects(changed(store,retainedMissing,retainedMissing),{code:'CATALOGUE_DAMAGED'});
  // Version-one indexes have no reference vocabulary, as before.
  assert.deepEqual(await changed(store,retainedMissing,retainedMissing,1),new Set());
  const stored=await retain(store,f.record,{searchText:'chunk '.repeat(13000),referenceTargets:[]}),text=RecordValueTree.prototype.text;
  t.mock.method(RecordValueTree.prototype,'text',async function*(...args){yield* text.apply(this,args);throw Error('Invalid trailing text block');});
  await assert.rejects(withRecordTerms(store,stored,{},2,()=>assert.fail('Audit accepted incomplete text')),/Invalid trailing text block/);
 }));
});
