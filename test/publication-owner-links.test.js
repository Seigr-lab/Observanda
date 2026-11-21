import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicationLinkResolver,publicationRecordDestination,publicationCollectionDestination} from '../src/publication-prose.js';
import {researchReference} from '../src/web/research-reference.js';

const record=(fields={})=>({id:randomUUID(),title:'Shared record',revision:'a'.repeat(64),body:'',sections:[],attachments:[],figures:[],...fields});

test('links resolve only to records of this workspace, at a matching pinned revision',()=>{
 const home=randomUUID(),shared=record(),selection={entries:[shared],projects:[],notebooks:[],homeEnabled:false},resolve=publicationLinkResolver(home,selection);
 const target={workspaceId:home,kind:'record',id:shared.id};
 assert.equal(publicationRecordDestination(selection.entries,target,home),shared);
 assert.equal(resolve(researchReference(target)),'entry:'+shared.id);
 assert.equal(resolve(researchReference({...target,revision:'a'.repeat(64)})),'entry:'+shared.id);
 assert.equal(resolve(researchReference({...target,revision:'b'.repeat(64)})),null);
 // A record of another workspace, or one not given as a destination, has no page here.
 assert.equal(resolve(researchReference({...target,workspaceId:randomUUID()})),null);
 assert.equal(resolve(researchReference({...target,id:randomUUID()})),null);
 // The workspace itself has no page without a homepage.
 assert.equal(resolve(researchReference({workspaceId:home,kind:'workspace',id:home})),null);
});

test('project and lab book links resolve by identity within this workspace; section links need a shown section',()=>{
 const home=randomUUID(),project={id:randomUUID(),title:'Field work'},notebook={id:randomUUID(),title:'Hives',projectId:project.id};
 const section={id:randomUUID(),title:'Method',body:'Steps'},shared=record({sections:[section]}),selection={entries:[shared],projects:[project],notebooks:[notebook],homeEnabled:false},resolve=publicationLinkResolver(home,selection);
 assert.equal(publicationCollectionDestination(selection,{workspaceId:home,kind:'project',id:project.id},home),project);
 assert.equal(resolve(researchReference({workspaceId:home,kind:'notebook',id:notebook.id})),'notebook:'+notebook.id);
 assert.equal(resolve(researchReference({workspaceId:randomUUID(),kind:'project',id:project.id})),null);
 const linked=resolve(researchReference({workspaceId:home,kind:'record',id:shared.id,selector:{version:1,kind:'section',id:section.id}}));
 assert.match(linked,new RegExp('^entry:'+shared.id+'#'));
 assert.equal(resolve(researchReference({workspaceId:home,kind:'record',id:shared.id,selector:{version:1,kind:'section',id:randomUUID()}})),null);
});
