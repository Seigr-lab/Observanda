import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ScientificEditDrafts} from '../src/scientific-edit-drafts.js';
import {clearVault} from '../src/encryption.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {projectTreeFixture} from './project-tree-fixture.js';
import {executeMaterialRequest} from '../src/material-requests.js';
import {DurableJobs} from '../src/jobs.js';
import {researchJobDefinitions} from '../src/research-jobs.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {revisionText} from '../src/web/revision-model.js';
import {digest} from '../src/storage-format.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {scientificCommandIdentity} from '../src/web/scientific-command-identity.js';
import {validScientificEdit} from '../src/scientific-edit-state.js';

test('uncertainty recovery accepts incomplete declared values before their units and rationale are authored',()=>{
 const entry={kind:'declared',scalar:{representation:'decimal',spelling:'-0.',radix:10},rationale:''};
 const pending={origin:null,offset:0,index:0,execution:{id:randomUUID(),jobId:randomUUID()}};
 assert.equal(validScientificEdit('uncertainty-input',{...pending,item:{id:randomUUID(),name:'',estimate:null,sensitivity:entry}}),true);
 assert.equal(validScientificEdit('uncertainty-covariance',{...pending,item:{i:0,j:0,value:entry}}),true);
 assert.equal(validScientificEdit('uncertainty-covariance',{...pending,item:{i:0,j:0,value:{...entry,scalar:null}}}),false);
});

test('scientific retries keep their job identity while changed recipes distinguish new results from corrections',async()=>{
 const input={title:'Readings',source:randomUUID(),value:'1.000000000000000001'};
 for(const expectedRevision of [null,digest('explicit retained result')]){
  const seed={id:randomUUID(),expectedRevision,jobId:randomUUID()};
  const submitted=await scientificCommandIdentity(seed,input);
  assert.equal(submitted.jobId,seed.jobId);
  assert.deepEqual(await scientificCommandIdentity(submitted,{...input}),submitted);
  const changed=await scientificCommandIdentity(submitted,{...input,value:'1.000000000000000002'});
  assert.notEqual(changed.jobId,submitted.jobId);
  assert.notEqual(changed.key,submitted.key);
  assert.equal(changed.expectedRevision,expectedRevision);
  assert.equal(changed.id===submitted.id,expectedRevision!==null);
 }
});

async function schemaCommand(materials,recordId,signal){
 const bytes=Buffer.from('reading\n1\n2\n'),file=await materials.startImport({recordId,name:'readings.csv',size:bytes.length});
 await materials.appendImport(file.id,0,[bytes]);
 const artifact=await materials.finishImport(file.id);
 const column={...defaultColumn({label:'reading'}),representation:'integer'};
 const base=await materials.dataset({recordId,title:'Readings',artifact,columns:[column]},{signal});
 const jobId=randomUUID(),command={recordId,title:'Revised readings',id:base.id,expectedRevision:base.revision,baseDataset:base,artifact,columnChanges:[{index:0,column:{...column,name:'revised reading'}}],exclusions:{}};
 const value={offset:0,rowPage:0,columns:[[0,command.columnChanges[0].column]],exclusions:[],intent:{id:jobId,key:digest(revisionText(command))}};
 return {base,value,command,jobId,bytes};
}

test('scientific checkpoints fence owners, earlier writes and discarded drafts without retaining an original',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-scientific-draft-'));
 const book=sampleNotebook(),f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),drafts=new ScientificEditDrafts(materials);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{force:true,recursive:true});});
 const scope={workspaceId:book.id,recordId:book.entries[0].id},id=randomUUID();
 const value={source:'intake/to-review',proposal:null},command={...scope,id,kind:'local-intake',base:null,value,expectedRevision:null};
 const page=await drafts.list(scope);assert.deepEqual(page,{items:[],next:null});
 const ack=await drafts.write(command);assert.equal(ack.state,'available');assert.equal((await drafts.write(command)).revision,ack.revision);
 const select={...scope,id,expectedRevision:ack.revision};const details=await drafts.read(select);assert.deepEqual(details.value,value);
 const visible=await drafts.list(scope);assert.equal(visible.items.length,1);assert.equal(visible.items[0].state,'unchecked');assert.ok(!JSON.stringify(visible).includes(value.source));
 const sibling={workspaceId:book.id,recordId:book.entries[1].id};
 assert.equal((await drafts.list(sibling)).items.length,0);await assert.rejects(drafts.read({...select,...sibling}),{code:'DRAFT_CHANGED'});
 const later=await drafts.write({...command,expectedRevision:ack.revision,value:{...value,source:'another/folder'}});
 await assert.rejects(drafts.read(select),{code:'DRAFT_CHANGED'});await assert.rejects(drafts.write(command),{code:'DRAFT_CHANGED'});
 const latest={...select,expectedRevision:later.revision};
 const write=f.workspace.writeMetadata.bind(f.workspace),fault=t.mock.method(f.workspace,'writeMetadata',async(file,...args)=>{
  if(file.startsWith('.observanda/scientific-edit-draft-list-by-owner/'))throw Object.assign(Error('Test volume is full.'),{code:'ENOSPC'});
  return write(file,...args);
 });
 const candidate={...command,expectedRevision:later.revision,value};
 await assert.rejects(drafts.write(candidate),{code:'ENOSPC'});fault.mock.restore();
 assert.equal((await drafts.read(latest)).value.source,'another/folder');
 assert.deepEqual((await drafts.browse({workspaceId:scope.workspaceId})).items.map(item=>item.revision),[later.revision]);
 const recovered=await drafts.write(candidate);
 assert.equal((await drafts.write(candidate)).revision,recovered.revision);
 await assert.rejects(drafts.write(command),{code:'DRAFT_CHANGED'});
 latest.expectedRevision=recovered.revision;await drafts.discard(latest);await drafts.discard(latest);
 assert.equal((await drafts.list(scope)).items.length,0);await assert.rejects(drafts.write(command),{code:'DRAFT_CHANGED'});
 assert.equal(await materials.current(id),null);
});

test('dedicated book recovery pages bind their actual parent, cursor, record and live permission', {timeout:180000},async t=>{
 const fixture=await projectTreeFixture(t),[book,other]=fixture.books;
 const create=(book,options)=>new ScientificEditDrafts(new ResearchMaterials(new LabBookStorage(book.root,book.labBookId,book.key)),options);
 let permitted=true;const drafts=create(book,{check:async()=>{if(!permitted)throw Object.assign(Error('Revoked'),{code:'ACCESS_LOCKED'});}});
 const recordId=book.before.book.entries[0].id,scope={workspaceId:book.namespaceId,recordId};
 const expected={...scope,projectId:book.projectId,labBookId:book.labBookId},acks=[];
 for(const name of ['first','second','third']){
  const value={source:'private folder '+name,proposal:null};
  acks.push(await drafts.write({...scope,id:randomUUID(),kind:'local-intake',base:null,value,expectedRevision:null}));
 }
 const first=await drafts.browse({workspaceId:scope.workspaceId,limit:2});
 assert.equal(first.items.length,2);assert.ok(first.next);assert.ok(!JSON.stringify(first).includes('private folder'));
 const second=await drafts.browse({workspaceId:scope.workspaceId,limit:2,cursor:first.next});
 assert.equal(second.items.length,1);assert.equal(second.next,null);
 assert.deepEqual([...first.items,...second.items].map(row=>row.id),acks.toReversed().map(row=>row.id));
 for(const row of [...first.items,...second.items])assert.deepEqual(row.owner,expected);
 await assert.rejects(drafts.list({...scope,limit:2,cursor:first.next}),{code:'DRAFT_CURSOR'});
 const sibling=create(other);assert.deepEqual(await sibling.browse({workspaceId:other.namespaceId}),{items:[],next:null});
 await assert.rejects(sibling.browse({workspaceId:other.namespaceId,limit:2,cursor:first.next}));
 const selected={...scope,id:acks[0].id,expectedRevision:acks[0].revision};
 permitted=false;await assert.rejects(drafts.read(selected),{code:'ACCESS_LOCKED'});await assert.rejects(drafts.discard(selected),{code:'ACCESS_LOCKED'});
 permitted=true;assert.equal((await drafts.read(selected)).value.source,'private folder first');
 const remote=new LabBookStorage(other.root,other.labBookId,other.key),foreign=new ResearchMaterials(remote);
 const {base}=await schemaCommand(foreign,other.before.book.entries[0].id,t.signal);
 const pinned={...base,workspaceId:other.namespaceId};let mayRead=true,verifyCount=0,revokeAt=null;
 const guard=()=>{if(!mayRead)throw Object.assign(Error('Source access revoked'),{code:'ACCESS_LOCKED'});};
 const linked=create(book,{sourceAccess:async()=>({
  use:async(ref,read)=>{guard();assert.deepEqual(ref,pinned);return read(remote,ref);},
  verify:async()=>{if(++verifyCount===revokeAt)mayRead=false;guard();},close:async()=>{}
 })});
 const draft=await linked.write({...scope,id:randomUUID(),kind:'schema',base:pinned,value:{offset:0,rowPage:0,columns:[],exclusions:[],intent:null},expectedRevision:null});
 const target={...scope,id:draft.id,expectedRevision:draft.revision};
 assert.deepEqual((await linked.read(target)).base,pinned);
 revokeAt=verifyCount+2;await assert.rejects(linked.read(target),{code:'ACCESS_LOCKED'});
 assert.ok((await linked.list(scope)).items.some(row=>row.id===draft.id&&row.state==='unchecked'));
});

test('lost scientific command replies resolve the original queue admission, retained node or intake batch', {timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-scientific-receipts-'));
 const book=sampleNotebook(),f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),drafts=new ScientificEditDrafts(materials);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{force:true,recursive:true});});
 const recordId=book.entries[0].id,scope={workspaceId:book.id,recordId};
 const queue=new DurableJobs(f.workspace,researchJobDefinitions(f.workspace,()=>queue));
 const request=(material,data)=>executeMaterialRequest(f.workspace,{material},data,{signal:t.signal,jobs:async()=>({queue,worker:{wake(){}}})});
 const save=async(kind,base,value)=>{
  const ack=await drafts.write({...scope,kind,base,value,id:randomUUID(),expectedRevision:null});
  return {...scope,id:ack.id,expectedRevision:ack.revision};
 };
 const {base,value,command,jobId,bytes}=await schemaCommand(materials,recordId,t.signal);
 const checkpoint=await save('schema',base,value);
 assert.equal((await drafts.read(checkpoint)).summary.state,'available');
 // The producer must roll back admission if the checkpoint belongs to a
 // different command, even when the queue accepted a valid dataset.
 await assert.rejects(request('dataset',{...command,title:'Another title',checkpoint,jobId}),{code:'DRAFT_CHANGED'});
 assert.equal(await queue.read(jobId),null);
 const enqueue=()=>request('dataset',{...command,checkpoint,jobId});
 assert.equal((await enqueue()).job.id,jobId);
 assert.equal((await drafts.read(checkpoint)).job.state,'queued');
 assert.equal((await enqueue()).job.id,jobId);
 const job=await queue.claim();assert.equal(job.id,jobId);
 assert.equal((await drafts.read(checkpoint)).job.state,'running');
 const prepared=await queue.definition(job).prepare(job,{signal:t.signal,progress:async()=>{}});
 const complete=await queue.complete(job.id,job.lease.token,prepared);
 const completed=await drafts.read(checkpoint);assert.deepEqual(completed.job.result,complete.result);assert.equal(completed.job.state,'completed');
 assert.equal((await enqueue()).job.state,'completed');
 const graph=(await request('calculation-graph-create',{recordId,title:'Exact working graph',source:complete.result,view:'observations',graphVersion:17,policy:defaultDatasetResourcePolicy()})).ref;
 const item={id:randomUUID(),kind:'constant',value:{constant:'10000000000000000001',representation:'integer',radix:10,unit:''}};
 const operation='calculation-graph-change',data={ref:graph,collection:'nodes',offset:0,item};
 const pending={origin:complete.result,offset:0,item,index:0,binding:null,fields:{},command:digest(revisionText({operation,data}))};
 const node=await save('graph-node',graph,pending),unrelated=await save('graph-node',graph,pending);
 const mutate=()=>request(operation,{...data,checkpoint:node});
 await assert.rejects(request(operation,{...data,item:{...item,value:{...item.value,constant:'5'}},checkpoint:node}),{code:'DRAFT_CHANGED'});
 const changed=(await mutate()).ref;
 assert.deepEqual((await mutate()).ref,changed);
 assert.deepEqual((await drafts.read(node)).result,changed);
 const stale=await drafts.read(unrelated);assert.equal(stale.summary.state,'conflict');assert.equal(stale.value,undefined);
 assert.equal((await request('calculation-graph-page',{ref:changed,collection:'nodes'})).total,1);
 const batch={id:randomUUID(),recordId,title:'Pending acquisition',purpose:'evidence',sourceMode:'files',count:1,bytes:bytes.length,provenance:'Field instrument'};
 const intake=await save('evidence-intake',null,{title:batch.title,mode:'files',purpose:batch.purpose,provenance:batch.provenance,selection:{count:1,fingerprint:digest('selected fixture file')},intent:batch});
 const started=await request('intake-start',batch);assert.equal(started.id,batch.id);
 assert.equal((await drafts.read(intake)).batch,started.id);
 assert.equal((await request('intake-start',batch)).id,started.id);
});

test('scientific checkpoints follow a selected record through interruption, cancellation, relocation and return', {timeout:300000},async t=>{
 const fixture=await projectTreeFixture(t),[from,to]=fixture.books,recordId=from.before.book.entries[0].id;
 const address=book=>({workspaceId:book.namespaceId,projectId:book.projectId,labBookId:book.labBookId});
 const open=book=>new LabBookStorage(book.root,book.labBookId,book.key);
 const source=open(from),target=open(to),left=new ScientificEditDrafts(new ResearchMaterials(source)),right=new ScientificEditDrafts(new ResearchMaterials(target));
 const origin=address(from),destination=address(to);
 const command=async(storage,owner,other)=>({id:randomUUID(),workspaceId:owner.workspaceId,recordId,sourceNotebookId:owner.labBookId,
  expectedStorageRevision:await storage.catalogue(async store=>(await store.member(await store.snapshot(),recordId)).revision),
  targetWorkspaceId:other.workspaceId,targetNotebookId:other.labBookId});
 const transfer=new RecordOwnerTransfer(source,target,{registry:fixture.registry,sourceOwner:origin,targetOwner:destination});
 const value={source:'Pending source before movement',proposal:null},id=randomUUID(),otherId=randomUUID();
 const save=(id,value)=>left.write({workspaceId:origin.workspaceId,recordId,id,kind:'local-intake',base:null,value,expectedRevision:null});
 const first=await save(id,value);await save(otherId,{...value,source:'Discard while away'});
 const inputs=await schemaCommand(left.materials,recordId,t.signal),queue=new DurableJobs(source,researchJobDefinitions(source,()=>queue));
 const schema=await left.write({workspaceId:origin.workspaceId,recordId,id:randomUUID(),kind:'schema',base:inputs.base,value:inputs.value,expectedRevision:null});
 const selection=row=>({workspaceId:row.owner.workspaceId,recordId,id:row.id,expectedRevision:row.revision});
 const checkpoint=selection(schema);
 await executeMaterialRequest(source,{material:'dataset'},{...inputs.command,checkpoint,jobId:inputs.jobId},{signal:t.signal,jobs:async()=>({queue,worker:{wake(){}}})});
 const job=await queue.claim(),prepared=await queue.definition(job).prepare(job,{signal:t.signal,progress:async()=>{}});
 const completed=(await queue.complete(job.id,job.lease.token,prepared)).result;
 const stopped=await command(source,origin,destination);
 await assert.rejects(transfer.start(stopped,{checkpoint:async phase=>{if(phase==='verified')throw Error('Pause before activation');}}),/Pause before activation/);
 assert.deepEqual((await right.browse({workspaceId:destination.workspaceId})).items,[]);
 await transfer.cancel({workspaceId:origin.workspaceId,id:stopped.id,recordId});
 assert.deepEqual((await right.browse({workspaceId:destination.workspaceId})).items,[]);
 assert.equal((await left.list({workspaceId:origin.workspaceId,recordId})).items.length,3);
 const moved=await transfer.start(await command(source,origin,destination));
 assert.equal(moved.phase,'complete');assert.equal(moved.progress.scientific.count,3);
 const movedRows=(await right.list({workspaceId:destination.workspaceId,recordId})).items;
 const archived=await right.read(selection(movedRows.find(row=>row.id===schema.id)));
 assert.equal(archived.archived,true);assert.deepEqual(archived.job.result,completed);assert.equal(archived.job.state,'completed');
 assert.equal((await right.materials.read(archived.job.result)).recordId,recordId);
 const selected=movedRows.find(row=>row.id===id);
 assert.deepEqual(selected.owner,{...destination,recordId});
 assert.notEqual(selected.revision,first.revision);assert.deepEqual((await right.read(selection(selected))).value,value);
 assert.deepEqual((await left.browse({workspaceId:origin.workspaceId})).items,[]);
 const newer={...value,source:'Edited in the destination'};
 await right.write({...selection(selected),kind:'local-intake',base:null,value:newer});
 await right.discard(selection(movedRows.find(row=>row.id===otherId)));
 const back=new RecordOwnerTransfer(target,source,{registry:fixture.registry,sourceOwner:destination,targetOwner:origin});
 assert.equal((await back.start(await command(target,destination,origin))).phase,'complete');
 const returning=(await left.list({workspaceId:origin.workspaceId,recordId})).items;
 assert.deepEqual(new Set(returning.map(row=>row.id)),new Set([id,schema.id]));
 assert.deepEqual((await left.read(selection(returning.find(row=>row.id===id)))).value,newer);
 assert.deepEqual((await left.read(selection(returning.find(row=>row.id===schema.id)))).job.result,completed);
 assert.deepEqual((await right.browse({workspaceId:destination.workspaceId})).items,[]);
});
