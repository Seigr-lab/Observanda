import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stat,rename} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {projectTreeFixture} from './project-tree-fixture.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {ComparisonJobAccess} from '../src/comparison-job-access.js';
import {datasetExchangeJob,datasetExchangeDelivery,queueDatasetExchange,readExchangeCandidate} from '../src/dataset-exchange-jobs.js';
import {preparedExchangeMembers} from '../src/dataset-exchange-files.js';
import {datasetJobs} from '../src/dataset-jobs.js';
import {DurableJobs} from '../src/jobs.js';

function service(materials){
 const comparisonAccess=new ComparisonJobAccess();
 const definition=datasetExchangeJob(materials,()=>queue,comparisonAccess);
 const queue=new DurableJobs(materials.workspace,{'dataset.exchange':definition},{leaseMs:90000});
 return {comparisonAccess,definition,queue};
}

test('retained dataset downloads follow only their record through an interrupted owner transfer and return',{timeout:240000},async t=>{
 const fixture=await projectTreeFixture(t),[from,to]=fixture.books;
 const directory=new LabBookDirectory(fixture.registry);
 for(const book of [from,to])await directory.register(book.projectId,book);
 const storage=book=>new LabBookStorage(book.root,book.labBookId,book.key);
 const owner=book=>({projectId:book.projectId,labBookId:book.labBookId,workspaceId:book.namespaceId});
 const source=storage(from),target=storage(to),original=new ResearchMaterials(source),incoming=new ResearchMaterials(target);
 const queue=service(original),receiving=service(incoming),recordId=from.before.book.entries[0].id,bytes=Buffer.from('Count\n9007199254740993\n');
 const upload=await original.startImport({recordId,name:'counts.csv',size:bytes.length});
 await original.appendImport(upload.id,0,[bytes]);const artifact=await original.finishImport(upload.id);
 const table=await original.dataset({recordId,title:'Selected measurements',artifact});
 const command={recordId,ref:{...table,workspaceId:from.namespaceId},format:'csv',selection:{offset:0,count:null,columns:null,includeExcluded:true}};
 const id=randomUUID();await queueDatasetExchange(original,queue,command,id);
 const leased=await queue.queue.claim();
 const prepared=await queue.definition.prepare(leased,{signal:t.signal});
 const job=await queue.queue.complete(id,leased.lease.token,prepared);
 await queue.definition.discard(leased);
 assert.equal(job.state,'completed');
 const engine=(a,b,from,to)=>new RecordOwnerTransfer(a,b,{registry:fixture.registry,sourceOwner:owner(from),targetOwner:owner(to)});
 async function move(a,from,to){
  const selected=await a.catalogue(async store=>store.member(await store.snapshot(),recordId));
  return {id:randomUUID(),workspaceId:from.namespaceId,recordId,sourceNotebookId:from.labBookId,expectedStorageRevision:selected.revision,targetWorkspaceId:to.namespaceId,targetNotebookId:to.labBookId};
 }
 const transfer=engine(source,target,from,to),first=await move(source,from,to);
 await assert.rejects(transfer.start(first,{checkpoint:async stage=>{if(stage==='dataset-export-file')throw new Error('Simulated interruption between authenticated files');}}),/between authenticated files/);
 assert.equal((await readExchangeCandidate(source,job)).available,true);
 await assert.rejects(datasetExchangeDelivery(incoming,receiving,'dataset-exchange-status',{id,recordId},{check:async()=>{}}));
 const resume={id:first.id,workspaceId:from.namespaceId,recordId};
 await assert.rejects(transfer.resume(resume,{checkpoint:async stage=>{if(stage==='activating')throw new Error('Pause before admission');}}),/Pause before admission/);
 const member=[...preparedExchangeMembers(target,id,prepared)][0].content.file;
 await rename(member,member+'.unavailable');
 try{
  await assert.rejects(transfer.resume(resume));
  assert.equal((await readExchangeCandidate(source,job)).available,true);
  await assert.rejects(datasetExchangeDelivery(incoming,receiving,'dataset-exchange-status',{id,recordId},{check:async()=>{}}));
 }finally{await rename(member+'.unavailable',member);}
 assert.equal((await transfer.resume(resume)).phase,'complete');
 assert.equal((await readExchangeCandidate(source,job)).available,false);
 for(const {content} of preparedExchangeMembers(source,id,prepared))await assert.rejects(stat(content.file),{code:'ENOENT'});
 assert.ok((await datasetJobs(incoming,receiving.queue,recordId)).items.some(item=>item.id===id));
 const zip=await datasetExchangeDelivery(incoming,receiving,'dataset-exchange-download',{id,recordId},{signal:t.signal,download:async({chunks})=>{
  const parts=[];for await(const part of chunks)parts.push(part);return unzipSync(Buffer.concat(parts));
 }});
 assert.match(Buffer.from(zip['dataset.csv']).toString(),/9007199254740993/);
 await datasetExchangeDelivery(incoming,receiving,'dataset-exchange-discard',{id,recordId},{signal:t.signal});
 const back=await move(target,to,from);assert.equal((await engine(target,source,to,from).start(back)).phase,'complete');
 assert.deepEqual(await datasetExchangeDelivery(original,queue,'dataset-exchange-status',{id,recordId},{signal:t.signal}),{available:false});
 for(const {content} of preparedExchangeMembers(source,id,prepared))await assert.rejects(stat(content.file),{code:'ENOENT'});
});
