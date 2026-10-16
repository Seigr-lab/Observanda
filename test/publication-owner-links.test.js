import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicationLinkResolver,publicationRecordDestination} from '../src/publication-prose.js';
import {researchReference} from '../src/web/research-reference.js';

test('publication links resolve the namespace before choosing between copied record identities',()=>{
 const home=randomUUID(),one=randomUUID(),two=randomUUID(),recordId=randomUUID(),revision='a'.repeat(64);
 const first={id:randomUUID(),recordId,revision,title:'First owner',referenceNamespaces:[one],selectors:[]},second={id:randomUUID(),recordId,revision,title:'Second owner',referenceNamespaces:[two],selectors:[]};
 const selection={entries:[first,second],projects:[],notebooks:[],homeEnabled:false},resolve=publicationLinkResolver(home,selection),target={workspaceId:two,kind:'record',id:recordId};
 assert.equal(publicationRecordDestination(selection.entries,target,home),second);
 assert.equal(resolve(researchReference(target)),'entry:'+second.id);
 assert.equal(resolve(researchReference({...target,workspaceId:one})),'entry:'+first.id);
 assert.equal(resolve(researchReference({...target,workspaceId:home})),null);
 assert.equal(resolve(researchReference({...target,workspaceId:randomUUID()})),null);
 assert.equal(resolve(researchReference({...target,revision:'b'.repeat(64)})),null);
 assert.equal(publicationLinkResolver(home,{...selection,entries:[first]})(researchReference(target)),null);
});
test('retained revision preference and admitted aliases are specific to the selected owner',()=>{
 const home=randomUUID(),one=randomUUID(),two=randomUUID(),alias=randomUUID(),recordId=randomUUID(),revision='a'.repeat(64);
 const current={id:recordId,revision,selectors:[]},foreign={id:randomUUID(),recordId,revision,historical:true,referenceNamespaces:[one],selectors:[]},historical={id:randomUUID(),recordId,revision,historical:true,referenceNamespaces:[two,alias],selectors:[]},entries=[foreign,current,historical],resolve=publicationLinkResolver(home,{entries,projects:[],notebooks:[],homeEnabled:true});
 const target={workspaceId:alias,kind:'record',id:recordId,revision};
 assert.equal(publicationRecordDestination(entries,target,home),historical);assert.equal(resolve(researchReference(target)),'entry:'+historical.id);
 assert.equal(resolve(researchReference({...target,workspaceId:home,revision:undefined})),'entry:'+current.id);
 assert.equal(resolve(researchReference({...target,workspaceId:two,revision:undefined})),null);
 assert.equal(resolve(researchReference({...target,kind:'notebook'})),null);
});

test('copied aliases cannot choose an arbitrary owner or override an explicit canonical namespace',()=>{
 const home=randomUUID(),one=randomUUID(),two=randomUUID(),alias=randomUUID(),recordId=randomUUID(),revision='a'.repeat(64);
 const first={id:randomUUID(),recordId,revision,sourceWorkspaceId:one,referenceNamespaces:[one,alias]},second={id:randomUUID(),recordId,revision,sourceWorkspaceId:two,referenceNamespaces:[two,alias,one]};
 assert.equal(publicationRecordDestination([first,second],{workspaceId:alias,id:recordId},home),null);
 assert.equal(publicationRecordDestination([second,first],{workspaceId:one,id:recordId},home),first);
 assert.equal(publicationRecordDestination([second,{...first,revision:'b'.repeat(64)}],{workspaceId:one,id:recordId,revision},home),null);
 const resolve=publicationLinkResolver(home,{entries:[],projects:[{...first,sourceId:recordId},{...second,sourceId:recordId}],notebooks:[]});
 assert.equal(resolve(researchReference({workspaceId:alias,id:recordId,kind:'project'})),null);
 assert.equal(resolve(researchReference({workspaceId:one,id:recordId,kind:'project'})),'project:'+first.id);
});
