import '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {projectPublication} from '../src/publication-projection.js';
import {siteLayoutDefaults} from '../src/web/website-model.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {publicationSourceIdentity} from '../src/publication-owner-identities.js';
import {recordReferenceNamespaces} from '../src/research-reference-namespace.js';
import {researchId} from '../src/web/research-reference.js';
test('public identities distinguish independent copies deterministically',()=>{
 const foreign=id(),other=id(),record=id(),first=publicationSourceIdentity(foreign,'record',record);
 assert.ok(researchId(first));assert.notEqual(first,record);assert.notEqual(first,publicationSourceIdentity(other,'record',record));assert.notEqual(first,publicationSourceIdentity(foreign,'media',record));assert.equal(first,publicationSourceIdentity(foreign,'record',record));
 assert.throws(()=>publicationSourceIdentity('../path','record',record),{code:'INVALID'});assert.throws(()=>publicationSourceIdentity(foreign,'other',record),{code:'INVALID'});
});
test('a record relation to its own project uses the admitted project label and identity',()=>{
 const book=sampleNotebook(),selection={projects:book.projects,notebooks:book.notebooks,entries:book.entries.filter(entry=>entry.share),pages:[],homeEnabled:false};
 const record=selection.entries[0],project=book.projects.find(item=>book.notebooks.some(n=>n.id===record.notebookId&&n.projectId===item.id));
 record.relations=[{id:id(),type:'related',role:'related',target:{workspaceId:book.id,kind:'project',id:project.id}},{id:id(),type:'related',target:{workspaceId:id(),kind:'project',id:project.id}}];
 const projected=projectPublication({...book,website:{design:siteLayoutDefaults(),palette:{},typography:{}}},selection,{publicationTarget:'entry:'+record.id,entryDestinations:[record]});
 assert.deepEqual(projected.entries[0].relations.map(link=>[link.kind,link.id,link.label]),[['project',project.id,project.title]]);
 assert.deepEqual(projected.projects.map(item=>Object.keys(item).sort()),book.projects.map(()=>['id','title']));
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

test('namespace resolution preserves exact transferred identity proofs',async()=>{
 const current=id(),prior=id(),foreign=id(),projectId=id(),recordId=id(),unrelated=id(),row=originRow(recordId,current,prior),objects=new Map([
  ['record:reference-origin:record:'+recordId+':'+prior,row]
 ]),store=namespaceStore({current,projectId,objects});
 const refs=[{workspaceId:current,id:recordId},{workspaceId:prior,id:recordId},{workspaceId:current,id:unrelated},{workspaceId:foreign,id:unrelated}];
 const expected=[];for(const ref of refs)expected.push(await recordReferenceNamespaces(namespaceStore({current,projectId,objects}),ref));
 assert.deepEqual(expected,[[current,prior],[current,prior],[current],[foreign]]);
 objects.set('record:reference-origin:record:'+recordId+':'+prior,{...row,namespaceId:id()});
 await assert.rejects(recordReferenceNamespaces(store,refs[0]),{code:'CATALOGUE_DAMAGED'});
});

test('namespace resolution observes an origin written after an earlier empty result',async()=>{
 const store=namespaceStore({readCache:null}),recordId=id(),prior=id();
 assert.deepEqual(await recordReferenceNamespaces(store,{workspaceId:store.current,id:recordId}),[store.current]);
 store.objects.set('record:reference-origin:record:'+recordId+':'+prior,originRow(recordId,store.current,prior));
 assert.deepEqual(await recordReferenceNamespaces(store,{workspaceId:store.current,id:recordId}),[store.current,prior]);
 assert.equal(store.calls.pages,0);assert.equal(store.calls.identities,2);
});
