import {sampleNotebook} from '../src/sample.js';
import {selectedContent} from '../src/web/website-model.js';
import {projectPublication} from '../src/publication-projection.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {PublicationOwnerIdentities} from '../src/publication-owner-identities.js';
import {publicationLinkResolver} from '../src/publication-prose.js';
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
