import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {publicationSourcePage} from '../src/publication-source-page.js';

test('source page labels preserve owner addresses without adopting research or private settings',()=>{
 const projectId=id(),notebookId=id(),namespace=id(),projectNamespace=id(),host={workspaceId:id()};
 const owner={workspaceId:namespace,projectId,labBookId:notebookId,projectNamespaceId:projectNamespace},metadata={id:namespace,projects:[{id:projectId,title:'Shared project',privateSettings:'private sentinel'}],notebooks:[{id:notebookId,projectId,title:'Other book'}]},record={id:id(),title:'Observation',notebookId,type:'note',share:false,body:'private original',attachments:[{id:id(),kind:'image',caption:'Evidence',share:true,privateMetadata:'attachment private sentinel'}]},before=structuredClone({metadata,record});
 const page=publicationSourcePage(host,owner,metadata,record);
 assert.notEqual(page.project.id,projectId);assert.equal(page.recordId,record.id);assert.equal(page.owner.workspaceId,namespace);assert.notEqual(page.record.id,record.id);assert.notEqual(page.record.attachments[0].id,record.attachments[0].id);assert.equal(page.record.attachments[0].sourceId,record.attachments[0].id);
 assert.equal(page.target,'entry:'+page.record.id);assert.equal(page.path,'entries/'+page.record.id+'.html');assert.equal(page.record.notebookId,page.notebook.id);assert.equal(page.notebook.projectId,page.project.id);
 assert.equal(JSON.stringify(page).includes('private sentinel'),false);assert.equal(JSON.stringify(page).includes('private original'),false);assert.equal(JSON.stringify(page).includes('attachment private sentinel'),false);assert.deepEqual({metadata,record},before);
 const other=id(),copy=publicationSourcePage(host,{...owner,workspaceId:other,projectNamespaceId:id()},{...metadata,id:other},record);assert.notEqual(copy.target,page.target);assert.notEqual(copy.project.id,page.project.id);
 assert.throws(()=>publicationSourcePage(host,{...owner,workspaceId:id()},metadata,record),{code:'WORKSPACE_CHANGED'});
});
