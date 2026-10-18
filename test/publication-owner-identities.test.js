import '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {selectedContent} from '../src/web/website-model.js';
import {projectPublication} from '../src/publication-projection.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {PublicationOwnerIdentities} from '../src/publication-owner-identities.js';
import {publicationLinkResolver} from '../src/publication-prose.js';
import {recordReferenceNamespaces,withRecordReferenceNamespaces,referenceOriginKey} from '../src/research-reference-namespace.js';
import {AppError} from '../src/errors.js';
import {researchReference,researchId} from '../src/web/research-reference.js';
test('public identities preserve local destinations and distinguish independent copies',()=>{
 const host=id(),foreign=id(),other=id(),record=id(),ids=new PublicationOwnerIdentities(host);
 assert.equal(ids.identity(host,'record',record),record);const first=ids.identity(foreign,'record',record);assert.ok(researchId(first));assert.notEqual(first,record);assert.notEqual(first,ids.identity(other,'record',record));assert.notEqual(first,ids.identity(foreign,'media',record));assert.equal(first,new PublicationOwnerIdentities(host).identity(foreign,'record',record));
 const project=id(),projectNamespace=id();assert.equal(ids.project({workspaceId:foreign,projectId:project,projectNamespaceId:projectNamespace},project),ids.project({workspaceId:other,projectId:project,projectNamespaceId:projectNamespace},project));
 assert.throws(()=>ids.identity(host,'project',record),{code:'PUBLICATION_IDENTITY'});assert.throws(()=>ids.identity('../path','record',record),{code:'INVALID'});
});
test('public collection links use only the admitted owner and return its derived destination',()=>{
 const host=id(),foreign=id(),unknown=id(),sourceId=id(),other=id(),projectId=id(),notebookId=id();
 const resolve=publicationLinkResolver(host,{homeEnabled:true,entries:[],projects:[{id:projectId,sourceId,referenceNamespaces:[foreign]},{id:other,sourceId,referenceNamespaces:[host]}],notebooks:[{id:notebookId,sourceId,referenceNamespaces:[foreign]}],pages:[]});
 assert.equal(resolve(researchReference({workspaceId:foreign,kind:'project',id:sourceId})),'project:'+projectId);assert.equal(resolve(researchReference({workspaceId:host,kind:'project',id:sourceId})),'project:'+other);assert.equal(resolve(researchReference({workspaceId:foreign,kind:'notebook',id:sourceId})),'notebook:'+notebookId);assert.equal(resolve(researchReference({workspaceId:unknown,kind:'project',id:sourceId})),null);assert.equal(resolve(researchReference({workspaceId:foreign,kind:'workspace',id:foreign})),null);
});

test('relation projection uses the admitted collection label and derived destination',()=>{
 const book=sampleNotebook(),foreign=id(),sourceId=book.projects[0].id,derived=id(),selection=selectedContent(book);
 selection.projects=selection.projects.map(project=>({...project,id:derived,sourceId,referenceNamespaces:[foreign],title:'Selected foreign project'}));selection.notebooks=selection.notebooks.map(notebook=>({...notebook,projectId:derived}));
 const record=selection.entries[0];record.relations=[{id:id(),type:'related',role:'related',target:{workspaceId:foreign,kind:'project',id:sourceId}}];
 const projected=projectPublication(book,selection);assert.equal(projected.entries[0].relations[0].id,derived);assert.equal(projected.entries[0].relations[0].label,'Selected foreign project');assert.equal('referenceNamespaces' in projected.projects[0],false);
});

function namespaceStore({current=id(),projectId,readCache={},objects=new Map()}={}){
 const calls={snapshots:0,pages:0,identities:0,objects:[]};
 const store={workspace:{projectId},readCache,current,objects,calls,
  async snapshot(...args){assert.equal(args.length,0,'ownership comes from the current transaction, not a historical source snapshot');calls.snapshots++;return {metadata:{id:store.current}};},
  async object(key){calls.objects.push(key);return objects.get(key)??null;},
  async objectIdPage(prefix,{limit,signal}){signal?.throwIfAborted();calls.pages++;assert.equal(prefix,'record:reference-origin:record:');assert.equal(limit,1);const keys=[...objects.keys()].filter(key=>key.startsWith(prefix));return {items:keys.slice(0,1),next:keys.length>1?keys[0]:null};},
  async *objectIdEntries(prefix){calls.identities++;for(const key of [...objects.keys()].sort())if(key.startsWith(prefix))yield key;}
 };return store;
}
function originRow(recordId,current,prior){return {version:1,kind:'record',id:recordId,namespaceId:current,sourceNamespace:prior,transferId:id(),sourceOwner:{workspaceId:prior,projectId:null,labBookId:null}};}

test('capture namespace facts stay inside one current reader and an empty origin proof covers every selected identity',async()=>{
 const store=namespaceStore(),recordId=id();let escaped;
 await withRecordReferenceNamespaces(store,async resolve=>{
  escaped=resolve;
  for(let n=0;n<720;n++)assert.deepEqual(await resolve({workspaceId:store.current,id:id()}),[store.current]);
  await assert.rejects(resolve({workspaceId:store.current,id:'invalid'}),{code:'INVALID'});
 });
 assert.deepEqual(store.calls,{snapshots:1,pages:1,identities:0,objects:[]});
 await assert.rejects(escaped({workspaceId:store.current,id:recordId}),{code:'INVALID'});
 // A subsequent read, even on the same owner/store, must prove current facts again.
 store.current=id();const prior=id(),row=originRow(recordId,store.current,prior);store.objects.set('record:reference-origin:record:'+recordId+':'+prior,row);
 await withRecordReferenceNamespaces(store,async resolve=>assert.deepEqual(await resolve({workspaceId:store.current,id:recordId}),[store.current,prior]));
 assert.equal(store.calls.pages,2);assert.equal(store.calls.identities,1);
 const other=namespaceStore();await withRecordReferenceNamespaces(other,async resolve=>assert.deepEqual(await resolve({workspaceId:other.current,id:recordId}),[other.current]));assert.equal(other.calls.snapshots,1);
});

test('capture namespace reuse preserves exact transferred and migrated identity proofs',async()=>{
 const current=id(),prior=id(),migrated=id(),projectId=id(),recordId=id(),unrelated=id(),row=originRow(recordId,current,prior),objects=new Map([
  ['record:reference-origin:record:'+recordId+':'+prior,row],
  ['project:research-migration',{version:1,projectId,namespaceId:current,sourceNamespace:migrated}],
  [referenceOriginKey({kind:'record',id:recordId}),{version:1,projectId,namespaceId:current,sourceNamespace:migrated,kind:'record',id:recordId}]
 ]),store=namespaceStore({current,projectId,objects});
 const refs=[{workspaceId:current,id:recordId},{workspaceId:prior,id:recordId},{workspaceId:current,id:unrelated},{workspaceId:migrated,id:unrelated}];
 const expected=[];for(const ref of refs)expected.push(await recordReferenceNamespaces(namespaceStore({current,projectId,objects}),ref));
 await withRecordReferenceNamespaces(store,async resolve=>{for(const [index,ref] of refs.entries())assert.deepEqual(await resolve(ref),expected[index]);});
 assert.deepEqual(expected,[[current,migrated,prior],[current,migrated,prior],[current],[migrated]]);assert.equal(store.calls.pages,1);assert.equal(store.calls.identities,3);
 objects.set('record:reference-origin:record:'+recordId+':'+prior,{...row,namespaceId:id()});
 await assert.rejects(withRecordReferenceNamespaces(store,resolve=>resolve(refs[0])),{code:'CATALOGUE_DAMAGED'});
});

test('capture namespace reuse refuses a failed global proof and cancellation without leaking its resolver',async()=>{
 const store=namespaceStore(),recordId=id();store.objectIdPage=async()=>{throw new AppError('CATALOGUE_DAMAGED');};
 await assert.rejects(withRecordReferenceNamespaces(store,resolve=>resolve({workspaceId:store.current,id:recordId})),{code:'CATALOGUE_DAMAGED'});assert.equal(store.calls.identities,0);
 const controller=new AbortController(),fresh=namespaceStore();let escaped;
 await assert.rejects(withRecordReferenceNamespaces(fresh,async resolve=>{escaped=resolve;await resolve({workspaceId:fresh.current,id:recordId});controller.abort();await resolve({workspaceId:fresh.current,id:recordId});},{signal:controller.signal}),{name:'AbortError'});
 assert.equal(fresh.calls.pages,1);await assert.rejects(escaped({workspaceId:fresh.current,id:recordId}),{name:'AbortError'});
 const aborted=namespaceStore();await assert.rejects(withRecordReferenceNamespaces(aborted,()=>assert.fail('aborted scope entered'),{signal:controller.signal}),{name:'AbortError'});assert.equal(aborted.calls.snapshots,0);
});

test('writer namespace resolution does not reuse an earlier empty origin result',async()=>{
 const store=namespaceStore({readCache:null}),recordId=id(),prior=id();
 await withRecordReferenceNamespaces(store,async resolve=>{
  assert.deepEqual(await resolve({workspaceId:store.current,id:recordId}),[store.current]);
  store.objects.set('record:reference-origin:record:'+recordId+':'+prior,originRow(recordId,store.current,prior));
  assert.deepEqual(await resolve({workspaceId:store.current,id:recordId}),[store.current,prior]);
 });
 assert.equal(store.calls.pages,0);assert.equal(store.calls.identities,2);
});
