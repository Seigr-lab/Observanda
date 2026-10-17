import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {PublicationDocumentBlocks,publicationDocumentBlockName} from '../src/publication-document-blocks.js';
import {digest,serialize} from '../src/storage-format.js';

test('native capture avoids writers for absent nodes and preserves flushed reads and failed captures',{timeout:60000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-capture-blocks-')),book=createNotebook('Retained blocks'),fixture=await encryptedFixture(directory,book),workspace=fixture.workspace;
 t.after(async()=>{clearVault(fixture.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-capture-blocks-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const withLock=workspace.withLock;let writers=0;
 workspace.withLock=function(...args){writers++;return withLock.apply(this,args);};
 const retained=await withPublicationCapture(workspace,async(captured,id,finish)=>{
  const initialWriters=writers,prefix='.observanda/release-inputs/'+id;
  for(let i=0;i<128;i++)assert.equal(await captured.readMetadata(prefix+'/'+publicationDocumentBlockName('value',digest('missing '+i)),65536),null);
  assert.equal(writers,initialWriters,'Missing immutable nodes opened writer transactions');
  const owner={kind:'source',workspaceId:book.id,websiteId:null,jobId:id,attemptId:null},blocks=new PublicationDocumentBlocks(captured,owner),values=[];
  for(let i=0;i<65;i++){const value={position:i,text:'Retained '+i},hash=await blocks.put('value',value);values.push({hash,value});}
  assert.ok(writers-initialWriters<=2,'New blocks were not batched');
  const first=values[0],file=prefix+'/'+publicationDocumentBlockName('value',first.hash);
  assert.deepEqual(await blocks.read('value',first.hash),first.value);
  const beforeFlushedReads=writers;
  assert.equal(await captured.readMetadata(file,65536),serialize(first.value));
  await assert.rejects(captured.readMetadata(file,1),{code:'LIMIT'});
  assert.equal(writers,beforeFlushedReads,'Flushed immutable-node reads opened writer transactions');
  const summary=serialize({first:first.hash});await captured.writeMetadata(prefix+'.json',summary);
  return finish(()=>({id,values,summary}));
 });
 const prefix='.observanda/release-inputs/'+retained.id;
 assert.equal(await workspace.readMetadata(prefix+'.json',65536),retained.summary);
 assert.equal((await workspace.metadataPage(prefix,{limit:1})).items.length,1);
 assert.equal(await workspace.readMetadata(prefix+'/'+publicationDocumentBlockName('value',retained.values[0].hash),65536),serialize(retained.values[0].value));
 let interrupted;
 await assert.rejects(withPublicationCapture(workspace,async(captured,id)=>{
  interrupted=id;let first;
  for(let i=0;i<34;i++){const text=serialize({value:i}),file='.observanda/release-inputs/'+id+'/'+publicationDocumentBlockName('value',digest(text));first??={file,text};await captured.writeMetadata(file,text);}
  await captured.writeMetadata(first.file,first.text);
 }),{code:'PUBLICATION_IDENTITY'});
 assert.deepEqual(await workspace.listMetadata('.observanda/release-inputs/'+interrupted),[]);
 assert.deepEqual(await workspace.listMetadata('.observanda/release-captures'),[]);
 // An occupied namespace is rejected before exposing the capture or its cleanup.
 const page=workspace.metadataPage;let occupied;
 workspace.metadataPage=async function(relative,options){if(relative.startsWith('.observanda/release-inputs/')){occupied=relative;assert.equal(options.localOnly,undefined);return {items:[{name:'existing.json',text:'retained'}],next:null};}return page.call(this,relative,options);};
 try{await assert.rejects(withPublicationCapture(workspace,()=>assert.fail('Occupied capture admitted')),{code:'PUBLICATION_IDENTITY'});}finally{workspace.metadataPage=page;}
 assert.ok(occupied);assert.deepEqual(await workspace.listMetadata('.observanda/release-captures'),[]);
 assert.equal(await workspace.readMetadata(prefix+'.json',65536),retained.summary);
});
