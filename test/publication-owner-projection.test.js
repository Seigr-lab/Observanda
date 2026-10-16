import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {recordRevision} from '../src/research.js';
import {publicationDescriptor} from '../src/publication-record-descriptor.js';
import {PublicationOwnerIdentities} from '../src/publication-owner-identities.js';
import {publicationOwnerProjection,publicationPageRecord} from '../src/publication-owner-projection.js';
import {publicationLinkResolver} from '../src/publication-prose.js';
import {projectPublication} from '../src/publication-projection.js';
import {selectedContent} from '../src/web/website-model.js';
import {defaultEditionRecord,selectEditionRecord} from '../src/web/publication-selection.js';
import {researchReference} from '../src/web/research-reference.js';

function source(){
 const metadata=sampleNotebook(),original=metadata.entries[0],attachment=id();
 original.attachments=[{id:attachment,kind:'image',share:true,caption:'Selected image',alt:'Observation',transcript:''}];
 original.body={type:'doc',content:[{type:'book_figure',attrs:{version:1,id:id(),figureId:attachment,alternative:'Observation image'}}]};
 const selection=defaultEditionRecord(original,recordRevision(original));
 return {metadata,original,input:{metadata,records:[{...publicationDescriptor(original,metadata),selection}]}};
}
test('two owners with copied research IDs keep distinct pages, images and inline figure links',()=>{
 const {metadata,original,input}=source(),host=id(),other=id(),identities=new PublicationOwnerIdentities(host),before=structuredClone(input),revision=recordRevision(original);
 const a=publicationOwnerProjection(input,{workspaceId:metadata.id},identities),b=publicationOwnerProjection({...input,metadata:{...metadata,id:other}},{workspaceId:other},identities);
 const ar=a.records[0],br=b.records[0];assert.notEqual(ar.id,br.id);assert.notEqual(ar.notebookId,br.notebookId);assert.notEqual(ar.media[0].id,br.media[0].id);assert.equal(ar.historical,undefined);assert.equal(ar.recordId,original.id);assert.equal(ar.revision,revision);assert.deepEqual(ar.selection,input.records[0].selection);assert.deepEqual(input,before);
 const page=publicationPageRecord(selectEditionRecord(original,ar.selection),ar);assert.equal(page.id,ar.id);assert.equal(page.notebookId,ar.notebookId);assert.equal(page.attachments[0].id,ar.media[0].id);assert.equal(page.body.content[0].attrs.figureId,ar.media[0].id);assert.equal(recordRevision(original),revision);
 const records=[ar,br],selection={entries:records,projects:[...a.metadata.projects,...b.metadata.projects],notebooks:[...a.metadata.notebooks,...b.metadata.notebooks]},resolve=publicationLinkResolver(host,selection);
 const target={kind:'record',workspaceId:other,id:original.id,selector:{version:1,kind:'figure',id:original.attachments[0].id}};
 assert.equal(resolve(researchReference(target)),'entry:'+br.id+'#record-figure-'+br.media[0].id);
 assert.equal(resolve(researchReference({...target,workspaceId:host})),null);
 const relation={id:id(),type:'Related to',label:'Selected observation',target};page.relations=[relation];
 const book={...metadata,id:host,projects:selection.projects,notebooks:selection.notebooks,entries:[page]},publicSelection=selectedContent(book),projected=projectPublication(book,publicSelection,{entryDestinations:records,publicationTarget:'entry:'+ar.id});
 const output=projected.entries[0];assert.equal(output.relations[0].id,br.id);assert.equal(output.relations[0].fragment,'record-figure-'+br.media[0].id);assert.equal(output.attachments[0].id,ar.media[0].id);assert.equal('sourceWorkspaceId' in output,false);assert.equal('referenceNamespaces' in output,false);assert.equal('mediaIdentities' in output,false);
});
test('independent books share their canonical project group, while unrelated copied projects remain separate',()=>{
 const {metadata,input}=source(),host=id(),projectNamespace=id(),projectId=metadata.projects[0].id,second=id(),identities=new PublicationOwnerIdentities(host);
 const first=publicationOwnerProjection(input,{workspaceId:metadata.id,projectId,projectNamespaceId:projectNamespace},identities),next=publicationOwnerProjection({...input,metadata:{...metadata,id:second}},{workspaceId:second,projectId,projectNamespaceId:projectNamespace},identities);
 assert.equal(first.metadata.projects[0].id,next.metadata.projects[0].id);assert.notEqual(first.metadata.notebooks[0].id,next.metadata.notebooks[0].id);
 assert.throws(()=>publicationOwnerProjection(input,{workspaceId:id()},identities),{code:'WORKSPACE_CHANGED'});
});
test('a retained revision points to its own owner current page, not a copied record in another book',()=>{
 const {metadata,original,input}=source(),host=id(),identities=new PublicationOwnerIdentities(host),pageId=id();
 const current=publicationOwnerProjection(input,{workspaceId:metadata.id},identities),old=publicationOwnerProjection({...input,records:[{...input.records[0],id:pageId,recordId:original.id,historical:true}]},{workspaceId:metadata.id},identities),row=old.records[0];
 const historical=publicationPageRecord(selectEditionRecord(original,row.selection),row),book={...metadata,id:host,projects:old.metadata.projects,notebooks:old.metadata.notebooks,entries:[historical]};
 const output=projectPublication(book,selectedContent(book),{entryDestinations:[{...current.records[0],id:id(),referenceNamespaces:[id()]},current.records[0],row],publicationTarget:'entry:'+row.id});
 assert.equal(output.entries[0].revisionEdition.current,current.records[0].id);assert.equal(output.entries[0].revisionEdition.revision,recordRevision(original));
});
