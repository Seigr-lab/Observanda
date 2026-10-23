import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {clearVault} from '../src/encryption.js';
import {retainedTable} from '../src/retained-tables.js';
import {createFigure} from '../src/web/figure-model.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';
import {enqueueDataset} from '../src/dataset-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {AppError} from '../src/errors.js';
import {AggregationWork,aggregationWorkFile} from '../src/dataset-aggregation-work.js';
const col=(name,representation='text',unit='')=>({...defaultColumn({label:name}),representation,unit});
const recipe=source=>({version:1,source,keys:[0],values:[{column:1,operation:'median',name:'Reference median'}],missing:'skip',note:'Median of reference readings per state.'});
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-aggregation-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),recordId=(await f.workspace.read()).book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 async function dataset(text,columns){const bytes=Buffer.from(text),upload=await m.startImport({recordId,name:'readings.csv',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id);return m.dataset({recordId,title:'Reference readings',artifact,columns});}
 return {...f,m,recordId,dataset,directory};
}
const inspect=(m,ref,column,offset=0)=>m.measurements.inspect({ref,selector:{kind:'cell',page:0,row:0,column}},{offset});

test('aggregation checkpoint values cross metadata pages without changing Unicode or exact values',async t=>{
 const f=await fixture(t),id=randomUUID(),command={recordId:f.recordId,id},work=await new AggregationWork(f.m,command,{jobId:id}).open(1);
 const value={key:'Ω𐐷'.repeat(180000),cells:['9007199254740993','1/3'],members:{count:1}},state={groups:1,order:1,last:{page:0,row:0},phase:'input'};
 await work.put('group:0',value);await work.save(state);
 const reopened=await new AggregationWork(new ResearchMaterials(f.workspace),command,{jobId:id}).open(1);
 assert.deepEqual(await reopened.get('group:0'),value);const detached=await reopened.get('group:0');detached.cells[0]='changed';assert.deepEqual(await reopened.get('group:0'),value);
 const access=await createAccess('','Large intermediate recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const destination=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'large-value-restore')),access,vault,f.vault);
 const restored=await new AggregationWork(new ResearchMaterials(new Workspace(destination,vault)),command,{jobId:id}).open(1);
 assert.deepEqual(await restored.get('group:0'),value);
});

test('aggregation checkpoints preserve exact groups and source positions across interrupted workers',async t=>{
 const f=await fixture(t),count=641,source=await f.dataset('State,Reading\n'+Array.from({length:count},(_,i)=>`${i%7},${9007199254740993n+BigInt(i)}`).join('\n'),[col('State'),col('Reading','integer')]);
 const {queue,worker}=workspaceJobs(f.workspace);t.after(()=>worker.stop());const id=randomUUID();
 await enqueueDataset(f.m,queue,{recordId:f.recordId,title:'Resumable medians',aggregation:{...recipe(source),values:['median','sum','mean','count'].map(operation=>({column:1,operation,name:operation}))}},id);
 const first=await queue.claim(),command=first.input.command,file=aggregationWorkFile(id),controller=new AbortController();
 let longestWriterMs=0,writes=0;const began=Date.now();
 const writePage=token=>fn=>queue.transaction(async()=>{await queue.held(id,token);const started=Date.now();try{return await fn();}finally{writes++;longestWriterMs=Math.max(longestWriterMs,Date.now()-started);}});
 await assert.rejects(f.m.prepareDataset(command,{jobId:id,writePage:writePage(first.lease.token),signal:controller.signal,progress:async p=>{if(p.stage==='Grouping retained rows'&&p.done>=256)controller.abort();}}),{name:'AbortError'});
 const checkpoint=JSON.parse(await f.workspace.readMetadata(file,1048576));assert.equal(checkpoint.order,256);assert.equal(checkpoint.groups,7);assert.equal(checkpoint.phase,'input');assert.equal(await f.m.current(id),null);
 await assert.rejects(f.m.prepareDataset({...command,title:'Changed command'},{jobId:id}),{code:'MATERIAL_CHANGED'});
 await queue.release(id,first.lease.token,{error:new AppError('IO')});await queue.control(id,'retry');const second=await queue.claim(),fresh=new ResearchMaterials(f.workspace);
 const retained=fresh.retainedDatasetPage.bind(fresh),reads=[];fresh.retainedDatasetPage=async(doc,page)=>{if(doc.id===source.id)reads.push(page);return retained(doc,page);};
 const prepared=await fresh.prepareDataset(command,{jobId:id,writePage:writePage(second.lease.token)});
 assert.equal(Math.min(...reads),checkpoint.last.page);assert.equal(prepared.content.rowCount,7);
 await assert.rejects(queue.complete(id,first.lease.token,prepared),{code:'JOB_LEASE'});
 // A third worker reuses finished numerical work, including exact medians.
 const finalState=JSON.parse(await f.workspace.readMetadata(file,1048576));assert.equal(finalState.phase,'rows');assert.equal(finalState.order,count);
 fresh.retainedDatasetPage=()=>{throw Error('Completed aggregation replayed source rows');};
 const repeated=await fresh.prepareDataset(command,{jobId:id,writePage:writePage(second.lease.token)});assert.deepEqual(repeated.content,prepared.content);
 fresh.retainedDatasetPage=retained;const completed=await queue.complete(id,second.lease.token,repeated);assert.equal(await f.workspace.readMetadata(file,1048576),null);
 const expected=await fresh.prepareDataset(command.id?{...command,id:undefined,expectedRevision:undefined}:command);
 const result=await fresh.datasetPage(completed.result),baseline=await fresh.retainedDatasetPage({kind:'dataset',content:expected.content},0);
 assert.deepEqual(result.rows.map(r=>({...r,id:''})),baseline.rows.map(r=>({...r,id:''})));
 const members=await inspect(fresh,completed.result,1,80);assert.equal(members.aggregation.members[0].value,String(9007199254740993n+560n));
 await fresh.verify();
 t.diagnostic(JSON.stringify({inputRows:count,groups:7,checkpointRows:checkpoint.order,writes,longestWriterMs,recoveryAndVerificationMs:Date.now()-began}));
});

test('failed checkpoint writes retain the preceding aggregation root through fresh-key recovery',async t=>{
 const f=await fixture(t),source=await f.dataset('State,Reading\n'+Array.from({length:385},(_,i)=>`${i%3},${i}`).join('\n'),[col('State'),col('Reading','integer')]);
 const id=randomUUID(),command={recordId:f.recordId,id,title:'Checkpoint recovery',aggregation:recipe(source)},file=aggregationWorkFile(id),write=f.workspace.writeMetadata.bind(f.workspace);let checkpoints=0;
 f.workspace.writeMetadata=async(name,value)=>{const result=await write(name,value);if(name===file&&++checkpoints===2)throw new AppError('STORAGE_FULL');return result;};
 try{await assert.rejects(f.m.prepareDataset(command,{jobId:id}),{code:'STORAGE_FULL'});}finally{f.workspace.writeMetadata=write;}
 const checkpoint=JSON.parse(await f.workspace.readMetadata(file,1048576));assert.equal(checkpoint.order,128);assert.equal(await f.m.current(id),null);
 const access=await createAccess('','Aggregation checkpoint recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const destination=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'checkpoint-restore')),access,vault,f.vault),workspace=new Workspace(destination,vault),restored=new ResearchMaterials(workspace);
 const prepared=await restored.prepareDataset(command,{jobId:id}),ref=await workspace.withLock(()=>restored.commitDataset(command,prepared));
 assert.deepEqual((await restored.datasetPage(ref)).rows.map(r=>r.cells),[['0','192/1'],['1','383/2'],['2','385/2']]);
 assert.equal(await workspace.readMetadata(file,1048576),null);await restored.verify();
 await f.workspace.withLock(()=>write(file,JSON.stringify({...checkpoint,last:{page:999999,row:0}})));
 await assert.rejects(f.m.prepareDataset(command,{jobId:id}),{code:'MATERIAL_MISSING'});
 await f.workspace.withLock(()=>write(file,JSON.stringify(checkpoint)));
 await f.workspace.withLock(()=>write('.observanda/materials/sequences/aggregation-work-nodes/'+checkpoint.root.hash+'.json','{}'));
 await assert.rejects(f.m.prepareDataset(command,{jobId:id}),{code:'MATERIAL_MISSING'});
});

test('durable aggregation grows beyond the working cache with exact independent groups',async t=>{
 const f=await fixture(t),groups=257,source=await f.dataset('State,Reading\n'+Array.from({length:groups*2},(_,i)=>`${i%groups},${9007199254740993n+BigInt(i%groups)+BigInt(Math.floor(i/groups))}`).join('\n'),[col('State'),col('Reading','integer')]);
 const {queue,worker}=workspaceJobs(f.workspace);t.after(()=>worker.stop());const id=randomUUID();
 const storage=()=>f.workspace.catalogue(store=>store.db.get('SELECT count(*)::text AS objects,COALESCE(sum(octet_length(payload)),0)::text AS bytes FROM objects')),before=await storage();
 await enqueueDataset(f.m,queue,{recordId:f.recordId,title:'Independent retained groups',aggregation:recipe(source)},id);const started=Date.now();worker.start();let completed;
 for(;;){completed=await queue.read(id);if(['completed','failed','cancelled'].includes(completed.state))break;assert.ok(Date.now()-started<180000,'Durable aggregation worker did not finish: '+JSON.stringify(completed.progress));await new Promise(resolve=>setTimeout(resolve,200));}
 await worker.stop();assert.equal(completed.state,'completed',JSON.stringify(completed.error));let group=0;
 for await(const row of f.m.iterateDataset(completed.result)){
  assert.deepEqual(row.cells,[String(group),`${18014398509481987n+BigInt(group)*2n}/2`]);assert.deepEqual(row.aggregation[0],{included:2,excluded:0,missing:0,total:2});assert.equal(row.aggregationMembers.count,2);group++;
 }
 assert.equal(group,groups);assert.equal(await f.workspace.readMetadata(aggregationWorkFile(id),1048576),null);
 const after=await storage();t.diagnostic(JSON.stringify({durableGroups:groups,inputRows:groups*2,prepareCommitInspectMs:Date.now()-started,retainedObjectGrowth:Number(after.objects)-Number(before.objects),encryptedPayloadGrowthBytes:Number(after.bytes)-Number(before.bytes)}));
 await f.m.verify();
});

test('numerical grouping combines equivalent spellings while lexical grouping and source provenance remain distinct',async t=>{
 const f=await fixture(t),source=await f.dataset('State,Reading\n10,3\n010,5\n+10,7\n0.1,11',[{...col('State','radix-fraction'),radix:6},col('Reading','integer')]),legacy=recipe(source),numeric={...legacy,keySemantics:['numeric']};
 const lexical=await f.m.dataset({recordId:f.recordId,title:'Lexical states',aggregation:legacy});assert.equal((await f.m.read(lexical)).content.rowCount,4);
 const ref=await f.m.dataset({recordId:f.recordId,title:'Numerical states',aggregation:numeric}),page=await f.m.datasetPage(ref);assert.deepEqual(page.rows.map(r=>r.cells),[['10','5/1'],['0.1','11/1']]);assert.deepEqual((await f.m.read(ref)).content.aggregation,numeric);
 const members=await inspect(f.m,ref,0);assert.deepEqual(members.aggregation.members.map(m=>m.value),['10','010','+10']);assert.deepEqual(members.aggregation.members.map(m=>m.source.selector.row),[0,1,2]);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'numeric-copy')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copy,f.vault));assert.deepEqual((await inspect(restored,ref,0)).aggregation,members.aggregation);await restored.verify();
 const id=randomUUID();await assert.rejects(f.m.dataset({recordId:f.recordId,id,title:'Unknown equality',aggregation:{...numeric,keySemantics:['unknown']}}),{code:'DATASET_AGGREGATION'});assert.equal(await f.m.current(id),null);
});

test('reference readings become exact retained state medians reusable in four-band figures and tables, recalculation and recovery',async t=>{
 const f=await fixture(t),source=await f.dataset('State,Reading\n'+Array.from({length:6},(_,state)=>Array.from({length:66},(_,i)=>state+','+(state*100+i)).join('\n')).join('\n'),[col('State'),col('Reading','integer','s')]),a=recipe(source);
 const command={recordId:f.recordId,title:'State medians',aggregation:a},preview=await f.m.previewDataset(command);assert.equal(preview.rows.length,5);assert.equal(preview.rows[0].cells[1],'65/2');
 const medians=await f.m.dataset(command),data=await f.m.datasetPage(medians);assert.equal(data.rows.length,6);assert.equal(data.rows[5].cells[1],'1065/2');
 const first=await inspect(f.m,medians,1);assert.deepEqual(first.aggregation.counts,{included:66,excluded:0,missing:0,total:66});assert.equal(first.aggregation.members.length,16);assert.equal(first.aggregation.next,16);assert.equal(first.original,null);
 const members=[];let offset=0;do{const page=await inspect(f.m,medians,1,offset);members.push(...page.aggregation.members);offset=page.next;}while(offset!==null);
 assert.equal(members.length,66);assert.equal(members.at(-1).value,'65');assert.deepEqual(members.at(-1).source,{ref:source,selector:{kind:'cell',page:0,row:65,column:1}});
 assert.equal((await f.m.measurements.inspect(members[0].source)).original.ref.kind,'artifact');
 const bands=await f.dataset('State,A,B,C,D\n'+Array.from({length:6},(_,state)=>[state,...[40,50,60,70].map(v=>state*100+v)].join(',')).join('\n'),[col('State'),...['A','B','C','D'].map(n=>col(n,'integer','s'))]);
 const calculation={version:1,source:bands,view:'observations',joins:[{dataset:medians,keys:[{left:0,right:0}],where:null,unmatched:'error'}],steps:[1,2,3,4].map(i=>({name:'Difference '+i,operation:'subtract',left:{column:i},right:{column:6},unit:'s',condition:null})),where:null,selectionReason:'',calibration:null,note:'Subtract the retained state median from each of four calibration bands.'};
 const derived=await f.m.dataset({recordId:f.recordId,title:'Reference transfer',calculation}),table=await retainedTable(f.m,{ref:derived,selection:{columns:[0,7,8,9,10],offset:0,count:20,includeExcluded:false}});assert.deepEqual(table.rows[0].cells,['0','15/2','35/2','55/2','75/2']);
 const figure=await f.m.plot({recordId:f.recordId,title:'Four bands relative to reference',dataset:derived,base:createFigure(),mapping:{x:0,xKind:'category',values:[7,8,9,10].map(column=>({column,error:null})),group:null,operation:'raw',order:'source',kind:'line',numericPolicy:'safe'}});assert.equal(figure.figure.series.length,4);assert.equal(figure.figure.series[3].points[0].y,37.5);
 const provenance=await inspect(f.m,derived,7);assert.ok(provenance.derivedSources.some(s=>s.ref.revision===medians.revision&&s.selector.column===1));
 // Reapply against a deliberately revised source; old calculations stay pinned.
 const sourcePage=await f.m.datasetPage(source),sourceDoc=await f.m.read(source),revisedSource=await f.m.dataset({recordId:f.recordId,title:sourceDoc.title,id:source.id,expectedRevision:source.revision,artifact:sourceDoc.content.inputs[0],baseDataset:source,exclusions:{[sourcePage.rows[0].id]:'Rejected reference reading'}});
 const newMedians=await f.m.dataset({...command,id:medians.id,expectedRevision:medians.revision,aggregation:{...a,source:revisedSource}});assert.equal((await f.m.datasetPage(newMedians)).rows[0].cells[1],'33/1');assert.equal((await f.m.datasetPage(medians)).rows[0].cells[1],'65/2');
 const newDerived=await f.m.dataset({recordId:f.recordId,title:'Reference transfer',id:derived.id,expectedRevision:derived.revision,calculation:{...calculation,joins:[{...calculation.joins[0],dataset:newMedians}]}});assert.equal((await f.m.datasetPage(newDerived)).rows[0].cells[7],'7/1');assert.equal((await f.m.datasetPage(derived)).rows[0].cells[7],'15/2');
 const oldInspection=await inspect(f.m,medians,1);assert.equal(oldInspection.aggregation.members[0].status,'included');assert.equal((await inspect(f.m,newMedians,1)).aggregation.members[0].reason,'Rejected reference reading');
 const root=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(root,f.vault));assert.deepEqual(await retainedTable(restored,{ref:derived,selection:{columns:[0,7,8,9,10],offset:0,count:20,includeExcluded:false}}),table);assert.deepEqual((await inspect(restored,medians,1)).aggregation,oldInspection.aggregation);await restored.verify();
});

test('aggregation handles exact large and radix values, missing/excluded inputs and composite groups without silent rounding',async t=>{
 const f=await fixture(t),source=await f.dataset('State,Reading\na,9007199254740993\na,9007199254740994\na,\na,99\nb,\n1,2\n1.0,3',[col('State'),col('Reading','integer')]),data=await f.m.datasetPage(source),doc=await f.m.read(source),filtered=await f.m.dataset({recordId:f.recordId,title:doc.title,id:source.id,expectedRevision:source.revision,baseDataset:source,artifact:doc.content.inputs[0],exclusions:{[data.rows[3].id]:'Control excluded'}}),a=recipe(filtered);
 a.values=['median','mean','sum','min','max','count'].map(operation=>({column:1,operation,name:operation}));
 const ref=await f.m.dataset({recordId:f.recordId,title:'Exact summaries',aggregation:a}),rows=(await f.m.datasetPage(ref)).rows;assert.deepEqual(rows[0].cells,['a','18014398509481987/2','18014398509481987/2','18014398509481987/1','9007199254740993/1','9007199254740994/1','2']);assert.deepEqual(rows[0].aggregation[0],{total:4,included:2,excluded:1,missing:1});assert.deepEqual(rows[1].valueKinds.slice(1),['absent','absent','absent','absent','absent','string']);assert.equal(rows[1].cells.at(-1),'0');assert.equal(rows.length,4);
 const inspection=await inspect(f.m,ref,1);assert.deepEqual(inspection.aggregation.members.map(v=>v.status),['included','included','missing','excluded']);
 const id=randomUUID();await assert.rejects(f.m.dataset({recordId:f.recordId,id,title:'Strict',aggregation:{...a,missing:'error'}}),{code:'DATASET_AGGREGATION_MISSING'});assert.equal(await f.m.current(id),null);
 const radix=await f.dataset('State,Window,Reading\na,x,10\na,x,11\na,y,12',[col('State'),col('Window'),{...col('Reading','radix'),radix:6}]),grouped=await f.m.dataset({recordId:f.recordId,title:'Senary medians',aggregation:{...recipe(radix),keys:[0,1],values:[{column:2,operation:'median',name:'Median'}]}});assert.deepEqual((await f.m.datasetPage(grouped)).rows.map(r=>r.cells),[['a','x','13/2'],['a','y','8/1']]);
 // Schema/exclusion edits on the result preserve the original recipe and members.
 const revision=await f.m.dataset({recordId:f.recordId,title:'Reviewed summaries',id:ref.id,expectedRevision:ref.revision,baseDataset:ref,artifact:filtered,exclusions:{[rows[0].id]:'Result under review'}});assert.deepEqual((await f.m.read(revision)).content.aggregation,a);assert.deepEqual((await inspect(f.m,revision,1)).aggregation,inspection.aggregation);
});

test('invalid, cancelled and stale aggregation jobs never publish partial results and retries retain the pinned recipe',async t=>{
 const f=await fixture(t),source=await f.dataset('State,Reading\na,1\na,2',[col('State'),col('Reading','integer')]),a=recipe(source),command={recordId:f.recordId,title:'Queued medians',aggregation:a};
 for(const aggregation of [{...a,keys:[]},{...a,keys:[0,0]},{...a,values:[{column:0,operation:'median',name:'M'}]},{...a,values:[{column:1,operation:'median',name:'State'}]},{...a,values:[{column:1,operation:'unknown',name:'M'}]}])await assert.rejects(f.m.dataset({...command,aggregation}),{code:'DATASET_AGGREGATION'});
 const controller=new AbortController();controller.abort();await assert.rejects(f.m.previewDataset(command,{signal:controller.signal}),{name:'AbortError'});
 const {queue,worker}=workspaceJobs(f.workspace);t.after(()=>worker.stop());const id=randomUUID();await enqueueDataset(f.m,queue,command,id);const first=await queue.claim(),prepared=await queue.definition(first).prepare(first,{});await queue.control(id,'cancel');await assert.rejects(queue.complete(id,first.lease.token,prepared),{code:'JOB_CANCELLED'});await queue.release(id,first.lease.token);assert.equal(await f.m.current(id),null);
 await queue.control(id,'retry');const second=await queue.claim(),result=await queue.definition(second).prepare(second,{}),done=await queue.complete(id,second.lease.token,result);assert.equal(done.state,'completed');assert.equal((await f.m.datasetPage(done.result)).rows[0].cells[1],'3/2');
 const update={...command,id,expectedRevision:done.result.revision},pending=await f.m.prepareDataset(update);await f.m.dataset({...update,title:'Another editor'});await assert.rejects(f.workspace.withLock(()=>f.m.commitDataset(update,pending)),{code:'MATERIAL_CHANGED'});await f.m.verify();
});

test('grouping validates the complete input before preview, distinguishes missing keys and cancels while scanning',async t=>{
 const f=await fixture(t),source=await f.dataset('State,Reading\n'+Array.from({length:300},(_,i)=>[i%7,i===299?'':i].join(',')).join('\n')+'\n,3',[col('State'),col('Reading','integer')]),command={recordId:f.recordId,title:'All source rows',aggregation:{...recipe(source),missing:'error'}};
 await assert.rejects(f.m.previewDataset(command),{code:'DATASET_AGGREGATION_MISSING'});
 command.aggregation.missing='skip';const controller=new AbortController();await assert.rejects(f.m.prepareDataset(command,{signal:controller.signal,progress:async()=>controller.abort()}),{name:'AbortError'});
 const result=await f.m.dataset(command),rows=(await f.m.datasetPage(result)).rows;assert.equal(rows.length,8);assert.deepEqual(rows.at(-1).cells,['','3/1']);assert.equal(rows.at(-1).locator.key,'[["missing",""]]');await f.m.verify();
});

test('more than ten thousand retained groups remain exact, seek source members and survive verified recovery',async t=>{
 const f=await fixture(t),groups=10017,source=await f.dataset('State,Reading\n'+Array.from({length:groups},(_,i)=>`${i},${9007199254740992n+BigInt(i)}\n${i},${9007199254740993n+BigInt(i)}`).join('\n'),[col('State'),col('Reading','integer')]);
 const result=await f.m.dataset({recordId:f.recordId,title:'Growing state medians',aggregation:recipe(source)}),doc=await f.m.read(result);
 assert.equal(doc.content.rowCount,groups);const pageNumber=f.m.datasetPageCount(doc)-1,page=await f.m.retainedDatasetPage(doc,pageNumber),last=page.rows.at(-1);
 assert.deepEqual(last.cells,[String(groups-1),`${18014398509481985n+BigInt(groups-1)*2n}/2`]);assert.equal(last.aggregationMembers.count,2);
 let reads=0;const read=f.m.retainedDatasetPage.bind(f.m);f.m.retainedDatasetPage=async(...args)=>{if(args[0].id===source.id)reads++;return read(...args);};
 const selector={kind:'cell',page:pageNumber,row:page.rows.length-1,column:1},inspection=await f.m.measurements.inspect({ref:result,selector});
 assert.ok(reads<=2,'Late group inspection must not scan earlier source pages');assert.equal(inspection.aggregation.members.length,2);assert.equal(inspection.next,null);
 assert.deepEqual(inspection.aggregation.members.map(v=>v.value),[String(9007199254740992n+BigInt(groups-1)),String(9007199254740993n+BigInt(groups-1))]);
 f.m.retainedDatasetPage=read;
 const destination=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'large-groups-copy')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(destination,f.vault));
 assert.deepEqual((await restored.measurements.inspect({ref:result,selector})).aggregation,inspection.aggregation);await restored.verify();
});

test('late source-member pages seek directly and retained member corruption is rejected',async t=>{
 const f=await fixture(t),source=await f.dataset('State,Reading\n'+Array.from({length:2000},(_,i)=>'a,'+i).join('\n'),[col('State'),col('Reading','integer')]);
 const result=await f.m.dataset({recordId:f.recordId,title:'Many members',aggregation:recipe(source)});
 let reads=0;const read=f.m.retainedDatasetPage.bind(f.m);f.m.retainedDatasetPage=async(...args)=>{if(args[0].id===source.id)reads++;return read(...args);};
 const late=await inspect(f.m,result,1,1984);assert.equal(late.aggregation.members.length,16);assert.equal(late.aggregation.members[0].value,'1984');assert.equal(late.next,null);assert.equal(late.previous,1968);assert.ok(reads<=2);
 f.m.retainedDatasetPage=read;
 const root=(await f.m.read(result)).content.aggregationMembersIndex.root,file='.observanda/materials/sequences/nodes/'+root.hash+'.json';
 await f.workspace.withLock(()=>f.workspace.writeMetadata(file,'{}'));
 await assert.rejects(inspect(f.m,result,1,1984),{code:'MATERIAL_MISSING'});await assert.rejects(f.m.verify());
});


test('aggregation v3 preserves source-owned exact keys, long cells, refused commands and complete recovery',{timeout:180000},async t=>{
 const {defaultDatasetResourcePolicy}=await import('../src/web/dataset-resource-policy.js'),{blankUnitDefinition}=await import('../src/web/measurement-unit-model.js'),{verifyAggregationPolicy}=await import('../src/dataset-aggregation.js');
 const f=await fixture(t),policy=defaultDatasetResourcePolicy();Object.assign(policy.resources,{maxScalarCharacters:12000,maxOperations:200000,maxExponent:12000});
 const long='0'.repeat(9000)+'9007199254740993',label='?'.repeat(5000),unit={...blankUnitDefinition(),version:2,resourcePolicy:policy,dimensions:[{axis:'time',exponent:1}]},columns=[{...col('Key','rational'),resourcePolicy:policy},{...col('Value','integer','s'),resourcePolicy:policy,quantity:{origin:'measured',conversion:null,calibration:null,unitDefinition:unit}},col('Label')];
 const source=await f.dataset('Key,Value,Label\n'+[['1/3',long,label],['2/6','9007199254740994',label],['9007199254740993/1','3',label],['9007199254740994/1','4',label]].map(row=>row.join(',')).join('\n'),columns),a={version:3,resourcePolicy:policy,source,keys:[0],keySemantics:['numeric'],values:['sum','mean','median','min','max','count'].map(operation=>({column:1,operation,name:operation})),missing:'skip',note:'Preserve every original spelling and exact source position.'};
 const legacy={...a,version:1};delete legacy.resourcePolicy;await assert.rejects(f.m.previewDataset({recordId:f.recordId,title:'Legacy numeric refusal',aggregation:legacy}),{code:'DATASET_SCALAR_POLICY_VERSION'});
 const low=structuredClone(policy);low.resources.maxScalarCharacters=8192;const jobs=workspaceJobs(f.workspace);t.after(()=>jobs.worker.stop());const failedId=randomUUID(),command={recordId:f.recordId,title:'Refused declared aggregation',aggregation:{...a,resourcePolicy:low}};await enqueueDataset(f.m,jobs.queue,command,failedId);const job=await jobs.queue.claim();let error;try{await jobs.queue.definition(job).prepare(job,{signal:t.signal});}catch(caught){error=caught;}assert.equal(error?.code,'DATASET_CALCULATION_RESOURCE');await jobs.queue.release(job.id,job.lease.token,{error});assert.equal(await f.m.current(failedId),null);assert.deepEqual((await jobs.queue.read(job.id)).input.command.aggregation,command.aggregation);
 const result=await f.m.dataset({recordId:f.recordId,title:'Exact declared aggregation',aggregation:a},{signal:t.signal}),doc=await f.m.read(result),rows=(await f.m.datasetPage(result)).rows;assert.equal(rows.length,3);assert.deepEqual(rows[0].cells,['1/3','18014398509481987/1','18014398509481987/2','18014398509481987/2','9007199254740993/1','9007199254740994/1','2']);assert.notEqual(rows[1].locator.key,rows[2].locator.key);assert.deepEqual((await f.m.datasetColumn(doc,1)).quantity.unitDefinition,unit);assert.equal((await f.m.datasetColumn(doc,6)).quantity.unitDefinition,undefined);
 const provenance=await inspect(f.m,result,1);assert.equal(provenance.aggregation.members.length,2);assert.equal(provenance.aggregation.members[0].value.format,'dataset-cell');assert.equal((await f.m.measurements.inspect(provenance.aggregation.members[0].source,{offset:9000})).textPage.text,'9007199254740993');const keys=await inspect(f.m,result,0);assert.deepEqual(keys.aggregation.members.map(member=>member.value),['1/3','2/6']);t.diagnostic('Numeric grouping, all reducers, original source lookup and retained failed command passed.');
 const passthrough={...legacy,keys:[2],keySemantics:['lexical'],values:[{column:1,operation:'count',name:'Count'}]},counted=await f.m.dataset({recordId:f.recordId,title:'Complete lexical count',aggregation:passthrough},{signal:t.signal}),countedRow=(await f.m.datasetPage(counted)).rows[0];assert.equal(countedRow.cells[0].format,'dataset-cell');assert.equal(countedRow.cells[1],'4');assert.equal((await f.m.readDatasetCell(countedRow.cells[0],{offset:4096,limit:1024})).text,label.slice(4096));
 const table=await retainedTable(f.m,{ref:counted,selection:{columns:'all',offset:0,count:null,includeExcluded:true},version:3}),{retainedTableHTML}=await import('../src/publication-retained-tables.js');let html='';for await(const part of retainedTableHTML(f.m,{source:counted,table},{signal:t.signal}))html+=part;assert.ok(html.includes(label));assert.equal(html.includes('[object Object]'),false);
 await verifyAggregationPolicy(f.m,doc,{signal:t.signal});const forged=Object.create(f.m);forged.retainedDatasetPage=async(selected,page,options)=>{const value=await f.m.retainedDatasetPage(selected,page,options);if(selected.id===doc.id){value.rows=structuredClone(value.rows);value.rows[0].cells[1]='1/1';}return value;};await assert.rejects(verifyAggregationPolicy(forged,doc,{signal:t.signal}),{code:'MATERIAL_MISSING'});await assert.rejects(verifyAggregationPolicy(f.m,{...doc,content:{...doc.content,aggregation:{...a,resourcePolicy:low}}},{signal:t.signal}),{code:'DATASET_CALCULATION_RESOURCE'});t.diagnostic('Long lexical/count export and exact replay/refusal passed.');
 const access=await createAccess('','Aggregation policy recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const destination=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'policy-recovery')),access,vault,f.vault),restored=new ResearchMaterials(new Workspace(destination,vault));await restored.verify({signal:t.signal});assert.deepEqual((await restored.datasetPage(result)).rows,rows);assert.deepEqual((await inspect(restored,result,1)).aggregation,provenance.aggregation);assert.equal((await restored.read(counted)).content.aggregation.version,1);assert.deepEqual((await restored.read(result)).content.aggregation,a);assert.equal((await restored.readDatasetCell((await restored.datasetPage(counted)).rows[0].cells[0],{offset:4096,limit:1024})).text,label.slice(4096));t.diagnostic('Fresh-key copy, full verification and historical lexical recipe reopening passed.');
});
