import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reorganizeWorkspace,editNotebook} from '../src/structure.js';
import {sampleNotebook} from '../src/sample.js';
import {routeFor,resolveRoute} from '../src/web/navigation.js';
import {buildPublication} from '../src/publication.js';

test('workspace reorganization preserves all record identities, evidence, links and selections',()=>{
  const source=sampleNotebook(), before=structuredClone(source), id=source.projects[0].id;
  source.branding=[{target:'home',logos:[{id:randomUUID(),alt:'Identity'}]}];
  const result=reorganizeWorkspace(source,{workspaceTitle:'A wider workspace',workspaceDescription:'Independent projects',projectId:id,copyLogos:true});
  assert.equal(result.book.title,'A wider workspace');assert.equal(result.book.projects[0].title,before.title);
  assert.equal(result.book.projects[0].description,before.description);
  assert.deepEqual(result.book.entries,before.entries);assert.deepEqual(result.book.notebooks,before.notebooks);
  assert.equal(result.book.projects[0].id,id);assert.equal(result.book.projects[0].share,before.projects[0].share);
  assert.deepEqual(result.book.branding.find(b=>b.target==='project:'+id).logos,source.branding[0].logos);
  assert.equal(source.title,before.title);assert.equal(source.projects[0].title,before.projects[0].title);
});
test('creating a project from workspace details leaves existing projects and records intact',()=>{
  const source=sampleNotebook();
  const result=reorganizeWorkspace(source,{workspaceTitle:'New workspace',workspaceDescription:'',projectId:'new',copyLogos:false});
  assert.equal(result.book.projects.length,2);assert.deepEqual(result.book.projects[0],source.projects[0]);
  assert.equal(result.book.projects[1].share,false);assert.equal(result.book.projects[1].title,source.title);
  assert.deepEqual(result.book.entries,source.entries);assert.deepEqual(result.book.notebooks,source.notebooks);
  for(const change of [{workspaceTitle:' '},{projectId:randomUUID()},{copyLogos:'yes'},{extra:true}])assert.throws(()=>reorganizeWorkspace(source,{workspaceTitle:'New',workspaceDescription:'',projectId:'new',copyLogos:false,...change}),{code:'INVALID'});
});
test('notebook moves keep content and stable links but require renewed website selection',()=>{
  const book=sampleNotebook(), n=book.notebooks[0], original=structuredClone(book);
  const p={id:randomUUID(),title:'Destination',description:'',logoId:null,share:true};book.projects.push(p);
  const renamed=editNotebook(book,{id:n.id,title:'Measurements',projectId:n.projectId});
  assert.deepEqual(renamed.book.entries,book.entries);
  const moved=editNotebook(book,{id:n.id,title:'Measurements',projectId:p.id});
  assert.equal(moved.book.notebooks[0].id,n.id);assert.equal(moved.book.notebooks[0].projectId,p.id);
  for(const record of moved.book.entries){assert.equal(record.share,false);const prior=original.entries.find(e=>e.id===record.id);assert.deepEqual({...record,share:prior.share},prior);}
  assert.equal(buildPublication(moved.book).entries.length,0);
  assert.throws(()=>editNotebook(book,{id:n.id,title:'Missing parent',projectId:randomUUID()}),{code:'INVALID'});
});
test('navigation resolves stable project, notebook and record context and rejects missing locations',()=>{
  const b=sampleNotebook(),n=b.notebooks[0],e=b.entries[0];
  for(const hash of ['#/workspace','#/projects/'+n.projectId,'#/projects/'+n.projectId+'/records','#/notebooks/'+n.id,'#/notebooks/'+n.id+'/read','#/records/'+e.id,'#/preferences/appearance'])assert.equal(routeFor(resolveRoute(hash,b)),hash);
  const state=resolveRoute('#/records/'+e.id,b);assert.equal(state.notebook,n.id);assert.equal(state.project,n.projectId);
  assert.equal(resolveRoute('#/notebooks/'+n.id+'/read',b).bookReading,true);
  for(const hash of ['#/notebooks/'+n.id+'/unknown','#/projects/missing','#/notebooks/missing','#/records/missing','#/branding/%ZZ'])assert.equal(resolveRoute(hash,b).page,'workspace');
});

test('saved-record reading and editing routes resolve against metadata without complete records',()=>{
 const b=sampleNotebook(),id=b.entries[0].id,section=b.entries[0].sections[0]?.id??randomUUID();b.entries=[];
 for(const hash of ['#/records/'+id,'#/records/'+id+'/read','#/records/'+id+'/read/'+section]){
  const state=resolveRoute(hash,b,{contentReading:true});assert.equal(state.page,'record-reader');assert.equal(state.selected,id);assert.equal(routeFor(state),hash);
  assert.equal(state.recordReading,hash.includes('/read'));
 }
 for(const hash of ['#/records/missing','#/records/'+id+'/unknown','#/records/'+id+'/read/not-an-anchor'])assert.equal(resolveRoute(hash,b,{contentReading:true}).page,'workspace');
 assert.equal(resolveRoute('#/records/'+id,b).page,'workspace');
});
