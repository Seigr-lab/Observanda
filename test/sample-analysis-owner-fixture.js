import assert from 'node:assert/strict';
import {readProjectDomainRegistry} from '../src/project-domain-registry.js';
import {moduleDomains} from '../src/modules/domains.js';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {Laboratory} from '../src/laboratory.js';
import {seedSampleAnalysis} from './sample-analysis-fixture.js';
export async function sampleAnalysisOwnerFixture(t,count=2){
 const f=await projectTreeFixture(t),workspaceId=(await f.workspace.outline()).metadata.id;
 for(const book of f.books)await new LabBookDirectory(f.registry).register(book.projectId,book);
 const owners=[{storage:f.workspace,workspaceId,projectId:null,labBookId:null},...f.projects.map(p=>({storage:new ProjectStorage(p.root,p.projectId,p.key),workspaceId:p.namespaceId,projectId:p.projectId,labBookId:null})),...f.books.map(b=>({storage:new LabBookStorage(b.root,b.labBookId,b.key),workspaceId:b.namespaceId,projectId:b.projectId,labBookId:b.labBookId}))];
 const samples=Array.from({length:count},(_,i)=>({id:randomUUID(),code:'Sample '+String(i).padStart(4,'0'),material:'Synthetic solution',source:'Declared fixture',collectedOn:'2026-10-01',receivedOn:'2026-10-01'})),analyses=samples.map((s,i)=>({id:randomUUID(),code:'Analysis '+String(i).padStart(4,'0'),sampleId:s.id,result:{method:'Method 1',analyte:'Absorbance',kind:'numeric',value:0.3,unit:'AU',lower:0,upper:1,notes:'Private original notes'},status:'draft',review:null,updatedAt:'2026-10-01T00:00:00.000Z'}));
 for(const [index,owner] of owners.entries()){
  assert.deepEqual((await owner.storage.catalogue(readProjectDomainRegistry)).domains,moduleDomains);
  owner.service=new Laboratory(owner.storage);owner.lab={formatVersion:1,revision:0,samples,analyses:analyses.map(a=>({...a,result:{...a.result,value:index}})),events:[]};
  await owner.service.catalogue(store=>seedSampleAnalysis(store,owner.lab),{write:true});
 }
 return {...f,workspaceId,owners,samples,analyses};
}
