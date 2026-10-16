// A2 authoring workload: A1's 42 investigations, 70 declared runs and two
// revisions of one method per copy. This is synthetic authoring, not an import
// adapter or an assertion about the meaning of a user's historical records.
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {createRun} from '../src/web/record-workflow.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {recordFingerprint} from './fixtures/research-reconciliation.js';

export async function authoringGrowthFixture(directory,{copies=1}={}){
 const book=upgradeNotebook(sampleNotebook()),seed=book.entries[2],project=book.projects[0],notebook=book.notebooks[0];
 book.entries=[];book.projects=[];book.notebooks=[];
 for(let i=0;i<copies;i++){
  const owner={...structuredClone(project),id:randomUUID(),title:'Study '+(i+1),share:false};book.projects.push(owner);
  book.notebooks.push({...structuredClone(notebook),id:randomUUID(),projectId:owner.id,title:'Investigations '+(i+1)},
   {...structuredClone(notebook),id:randomUUID(),projectId:owner.id,title:'Additional observations '+(i+1)});
 }
 const f=await encryptedFixture(directory,book),service=new ResearchRecords(f.workspace,{}),ids=[],expectedRecords=new Map();
 let first=null,last=null,method=null,totalBytes=0,maximumSaveMs=0;
 const start=performance.now();
 async function save(records,previous=null){
  const began=performance.now(),result=await service.save({workspaceId:book.id,changes:records.map(record=>({id:record.id,expectedRevision:previous?recordRevision(previous):null,record}))},{recordIds:records.map(r=>r.id)});
  maximumSaveMs=Math.max(maximumSaveMs,performance.now()-began);
  for(const record of records){
   // Creation/update timestamps are assigned by the save command. All authored
   // fields and relationships remain the independent submitted expectation.
   const accepted=result.book.entries.find(value=>value.id===record.id);
   expectedRecords.set(record.id,recordFingerprint({...record,createdAt:accepted.createdAt,updatedAt:accepted.updatedAt}));
  }
  if(!previous)for(const record of result.book.entries){ids.push(record.id);totalBytes+=Buffer.byteLength(JSON.stringify(record));first??=record;last=record;}
  return result.book.entries;
 }
 for(let copy=0;copy<copies;copy++){
  const notebookId=book.notebooks[0].id;
  const make=(type,title)=>({...structuredClone(seed),id:randomUUID(),notebookId,type,title,share:false,
   body:'Observed sample detail. '.repeat(2300),sections:[],relations:[],figures:[],attachments:[],tags:['capacity',copy%2?'field':'bench']});
  const [initialMethod]=await save([make('protocol','Method '+copy)]);
  const [amended]=await save([{...initialMethod,title:'Amended method '+copy}],initialMethod);method??={initial:initialMethod,current:amended};
  const parents=[];
  for(let i=0;i<42;i+=10)parents.push(...await save(Array.from({length:Math.min(10,42-i)},(_,n)=>make('experiment','Investigation '+copy+' / '+(i+n)))));
  if(copy===0)first=parents[0];
  for(let i=0;i<70;i+=10){
   const runs=Array.from({length:Math.min(10,70-i)},(_,n)=>{
    const parent=parents[(i+n)%42],run=createRun({...book,entries:parents},parent,{revision:recordRevision(parent),title:'Run '+copy+' / '+(i+n)});
    return {...run,body:'Returned observation detail. '.repeat(1800),tags:['capacity',copy%2?'field':'bench']};
   });await save(runs);
  }
 }
 return {...f,book,service,ids,first,last,method,expectedRecords,metrics:{copies,records:ids.length,originalBytes:totalBytes,createMs:Math.round(performance.now()-start),maximumSaveMs:Math.round(maximumSaveMs)}};
}
