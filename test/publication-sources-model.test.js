import {sampleNotebook} from '../src/sample.js';
import {validateNotebook} from '../src/model.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {validPublicationSources,emptyPublicationSource,publicationSourceMetadata,resolvePublicationSource} from '../src/web/publication-sources-model.js';
import {websiteRecordShare} from '../src/web/website-selection.js';
test('publication source selection starts private and cannot select another namespace implicitly',()=>{
 const workspaceId=id(),projectId=id(),other=id(),record={id:id(),share:true},metadata={id:workspaceId,projects:[{id:projectId,share:true},{id:other,share:true}]},source=emptyPublicationSource(workspaceId);
 assert.equal(validPublicationSources([source]),true);assert.equal(websiteRecordShare(source.selection,record,projectId),false);assert.ok(publicationSourceMetadata(metadata,source).projects.every(project=>!project.share));
 source.projectIds=[projectId];source.selection.includeProjects=[projectId];const result=publicationSourceMetadata(metadata,source);assert.equal(result.projects[0].share,true);assert.equal(result.projects[1].share,false);assert.ok(metadata.projects.every(project=>project.share));
 assert.throws(()=>publicationSourceMetadata({...metadata,id:id()},source),/Invalid publication source/);assert.throws(()=>publicationSourceMetadata({...metadata,projects:[]},source),/Invalid publication source/);
 assert.equal(validPublicationSources([source,{...source}]),false);assert.equal(validPublicationSources([{...source,selection:{...source.selection,defaultShare:true}}]),false);assert.equal(validPublicationSources([{...source,selection:{...source.selection,includeProjects:[other]}}]),false);assert.equal(validPublicationSources([{...source,path:'local-only'}]),false);
});
test('equal record IDs in independent sources keep distinct consent and a total sparse-selection bound',()=>{
 const first=emptyPublicationSource(id()),second=emptyPublicationSource(id()),recordId=id();first.selection.records=[{id:recordId,share:true,attachments:[]}];second.selection.records=[{id:recordId,share:false,attachments:[]}];assert.equal(validPublicationSources([first,second]),true);assert.equal(websiteRecordShare(first.selection,{id:recordId,share:false},null),true);assert.equal(websiteRecordShare(second.selection,{id:recordId,share:true},null),false);
 first.selection.records=Array.from({length:1000},()=>({id:id(),share:true,attachments:[]}));assert.equal(validPublicationSources([first]),true);assert.equal(validPublicationSources([first,second]),false);
});

test('per-owner edition choices reject malformed records before source access',()=>{
 const source=emptyPublicationSource(id());source.edition={version:1,records:[]};assert.equal(validPublicationSources([source]),true);
 source.edition.records=[{id:id(),include:true}];assert.equal(validPublicationSources([source]),false);
 source.edition={version:1,records:[],unexpected:'local-only'};assert.equal(validPublicationSources([source]),false);
});

test('website source consent is validated with the owning document',()=>{
 const book=sampleNotebook(),source=emptyPublicationSource(id());book.website.researchSources=[source];
 assert.doesNotThrow(()=>validateNotebook(book));
 book.website.researchSources[0].selection.defaultShare=true;
 assert.throws(()=>validateNotebook(book));
});


test('dedicated book consent follows its book identity across parent changes without broadening consent',()=>{
 const workspaceId=id(),labBookId=id(),oldProject=id(),newProject=id(),recordId=id(),source=emptyPublicationSource(workspaceId,labBookId);
 source.projectIds=[oldProject];source.selection.includeProjects=[oldProject];source.selection.records=[{id:recordId,share:false,attachments:[{id:id(),share:false}]}];
 const before=structuredClone(source),metadata={id:workspaceId,projects:[{id:newProject,share:false}],notebooks:[{id:labBookId,projectId:newProject}]},owner={labBookId};
 const resolved=resolvePublicationSource(metadata,source,owner);assert.deepEqual(resolved.projectIds,[newProject]);assert.deepEqual(resolved.selection.includeProjects,[newProject]);assert.equal(websiteRecordShare(resolved.selection,{id:recordId,share:true},newProject),false);assert.deepEqual(resolved.selection.records,source.selection.records);assert.deepEqual(source,before);
 assert.equal(publicationSourceMetadata(metadata,source,owner).projects[0].share,true);
 const sparse={...source,selection:{...source.selection,includeProjects:[]}};assert.deepEqual(resolvePublicationSource(metadata,sparse,owner).selection.includeProjects,[]);
 assert.throws(()=>resolvePublicationSource(metadata,source,{labBookId:id()}),/Invalid publication source/);assert.throws(()=>resolvePublicationSource({...metadata,id:id()},source,owner),/Invalid publication source/);assert.throws(()=>resolvePublicationSource({...metadata,notebooks:[...metadata.notebooks,{id:id(),projectId:newProject}]},source,owner),/Invalid publication source/);
 assert.equal(validPublicationSources([{...source,projectIds:[oldProject,newProject]}]),false);assert.equal(validPublicationSources([{...source,labBookId:'invalid'}]),false);
 assert.throws(()=>resolvePublicationSource(metadata,{workspaceId,projectIds:[oldProject],selection:source.selection},owner),/Invalid publication source/);
});
