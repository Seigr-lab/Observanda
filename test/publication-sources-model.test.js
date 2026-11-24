import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {validPublicationSources} from '../src/web/publication-sources-model.js';
import {websiteRecordShare} from '../src/web/website-selection.js';
const emptyPublicationSource=(workspaceId,labBookId=null)=>({workspaceId,...(labBookId?{labBookId}:{}),projectIds:[],selection:{defaultShare:false,includeProjects:[],records:[]}});
test('publication source selection starts private and cannot select another namespace implicitly',()=>{
 const workspaceId=id(),projectId=id(),other=id(),record={id:id(),share:true},source=emptyPublicationSource(workspaceId);
 assert.equal(validPublicationSources([source]),true);assert.equal(websiteRecordShare(source.selection,record,projectId),false);
 source.projectIds=[projectId];source.selection.includeProjects=[projectId];assert.equal(validPublicationSources([source]),true);
 assert.equal(validPublicationSources([source,{...source}]),false);assert.equal(validPublicationSources([{...source,selection:{...source.selection,defaultShare:true}}]),false);assert.equal(validPublicationSources([{...source,selection:{...source.selection,includeProjects:[other]}}]),false);assert.equal(validPublicationSources([{...source,path:'local-only'}]),false);
});
test('equal record IDs in independent sources keep distinct consent and a total sparse-selection bound',()=>{
 const first=emptyPublicationSource(id()),second=emptyPublicationSource(id()),recordId=id();first.selection.records=[{id:recordId,share:true,attachments:[]}];second.selection.records=[{id:recordId,share:false,attachments:[]}];assert.equal(validPublicationSources([first,second]),true);assert.equal(websiteRecordShare(first.selection,{id:recordId,share:false},null),false);assert.equal(websiteRecordShare(first.selection,{id:recordId,share:true},null),true);assert.equal(websiteRecordShare(second.selection,{id:recordId,share:true},null),false);
 first.selection.records=Array.from({length:1000},()=>({id:id(),share:true,attachments:[]}));assert.equal(validPublicationSources([first]),true);assert.equal(validPublicationSources([first,second]),false);
});

test('per-owner edition choices reject malformed records before source access',()=>{
 const source=emptyPublicationSource(id());source.edition={version:1,records:[]};assert.equal(validPublicationSources([source]),true);
 source.edition.records=[{id:id(),include:true}];assert.equal(validPublicationSources([source]),false);
 source.edition={version:1,records:[],unexpected:'local-only'};assert.equal(validPublicationSources([source]),false);
});

test('dedicated book consent names at most one project',()=>{
 const labBookId=id(),oldProject=id(),newProject=id(),source=emptyPublicationSource(id(),labBookId);source.projectIds=[oldProject];source.selection.includeProjects=[oldProject];
 assert.equal(validPublicationSources([source]),true);
 assert.equal(validPublicationSources([{...source,projectIds:[oldProject,newProject]}]),false);assert.equal(validPublicationSources([{...source,labBookId:'invalid'}]),false);
});
