import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueueDataset} from '../src/dataset-jobs.js';
import {executeMaterialRequest} from '../src/material-requests.js';
import {retainedTableBlocks} from '../src/retained-tables.js';
import {retainedTableHTML} from '../src/publication-retained-tables.js';

const column=(name,representation='integer',radix=10)=>({...defaultColumn({label:name}),representation,radix});
const scalar=(left,right)=>({id:randomUUID(),kind:'scalar',operation:'add',left,right,condition:null,unit:''});
const constant=()=>({id:randomUUID(),kind:'constant',value:{constant:'1',representation:'integer',radix:10,unit:''}});
const selection={columns:'all',offset:0,count:null,includeExcluded:true};

test('graph dimensions grow independently while paged reads and complete exports preserve retained evidence',{timeout:300000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-graph-dimensions-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);
 let f,jobs;
 t.after(async()=>{await jobs?.worker.stop();await provider.close();detach();if(f)clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-graph-dimensions-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook();f=await encryptedFixture(directory,book);jobs=workspaceJobs(f.workspace);
 const m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id,request=(operation,data)=>executeMaterialRequest(f.workspace,{material:operation},data,{signal:t.signal});
 const stage=(name,facts)=>{t.diagnostic(JSON.stringify({dimension:name,...facts}));process.stdout.write('# '+name+' passed\n');};
 const build=async(kind,items)=>{const writer=m.sequences.builder(kind,fn=>fn());for(const item of items)await writer.append(item);return writer.finish();};
 async function dataset(rows,columns,name='values.json'){
  const bytes=Buffer.from(JSON.stringify({rows})),upload=await m.startImport({recordId,name,size:bytes.length});await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id);
  const sourceMapping={format:'json',rowsPath:'/rows',fields:columns.map(c=>({name:c.name,path:'/'+c.name}))};
  return {artifact,ref:await m.dataset({recordId,title:name,artifact,sourceMapping,columns},{signal:t.signal})};
 }
 async function graph(source,title,define){
  let ref=(await request('calculation-graph-create',{recordId,title,source})).ref;
  const original=ref,first=(await request('calculation-graph-page',{ref,collection:'bindings'})).items[0],definition=await f.workspace.withLock(()=>define(first));
  ref=await f.workspace.withLock(async()=>{const doc=await m.read(ref),content={...doc.content,graphBindingsIndex:await build('calculation-bindings',definition.bindings??[first]),graphNodesIndex:await build('calculation-nodes',definition.nodes),graphOutputsIndex:await build('calculation-outputs',definition.outputs)};return m.commit({kind:'analysis',id:doc.id,recordId,title,expectedRevision:ref.revision,content});});
  // The normal selected edit validates the complete indexed definition and pins its dependencies.
  const last=definition.outputs.at(-1);ref=(await request('calculation-graph-change',{ref,collection:'outputs',offset:definition.outputs.length-1,item:{...last,name:last.name+' retained'}})).ref;
  assert.equal((await request('calculation-graph-page',{ref:original,collection:'outputs'})).total,0);
  return {ref,...definition};
 }
 async function leased(job,operation){
  let pulse=Promise.resolve(),failure;const heartbeat=setInterval(()=>{pulse=pulse.then(()=>jobs.queue.pulse(job.id,job.lease.token)).catch(error=>{failure=error;});},jobs.queue.leaseMs/3);
  try{const result=await operation();await pulse;if(failure)throw failure;return result;}finally{clearInterval(heartbeat);await pulse;}
 }
 async function retain(ref,title){
  const id=randomUUID(),command={recordId,title,calculation:{version:4,graph:ref}};await enqueueDataset(m,jobs.queue,command,id);const job=await jobs.queue.claim();assert.equal(job.id,id);
  return (await leased(job,async()=>jobs.queue.complete(id,job.lease.token,await jobs.queue.definition(job).prepare(job,{signal:t.signal})))).result;
 }
 async function table(ref,{reader=m}={}){
  const retained=await request('retained-table',{ref,selection,version:3}),rows=[];
  for await(const block of retainedTableBlocks(reader,{ref,table:retained},{signal:t.signal})){assert.ok(block.table.rows.length<=16);assert.ok(block.table.headers.length<=8);rows.push(...block.table.rows);}
  let html='';for await(const chunk of retainedTableHTML(reader,{source:ref,table:retained},{signal:t.signal}))html+=chunk;
  assert.equal((html.match(/<tbody>/g)??[]).length,Math.ceil(rows.length/16));
  return {rows,html,retained};
 }

 await t.test('seventeen bindings retain distinct immutable input interpretations across the authoring page',async()=>{
  const seed=await dataset([{Key:1,Value:'10'}],[column('Key'),column('Value','radix',2)]),sources=[seed.ref];
  for(let radix=3;radix<=18;radix++){const previous=sources.at(-1);sources.push(await m.dataset({recordId,title:'Base '+radix,id:previous.id,expectedRevision:previous.revision,baseDataset:previous,artifact:seed.artifact,columnChanges:[{index:1,column:column('Value','radix',radix)}]},{signal:t.signal}));}
  assert.equal(new Set(sources.map(ref=>ref.revision)).size,17);
  const g=await graph(sources[0],'Independent input bindings',async first=>{
   const bindings=[first],nodes=[{id:randomUUID(),kind:'column',binding:{id:first.id,position:0},column:0}],address=position=>({id:nodes[position].id,position}),keys=await build('calculation-edges',[{left:address(0),right:0,semantics:'numeric'}]);
   for(let i=1;i<17;i++)bindings.push({id:randomUUID(),source:sources[i],view:'observations',match:{keysIndex:keys,unmatched:'error'}});
   const values=[];for(let i=0;i<17;i++){nodes.push({id:randomUUID(),kind:'column',binding:{id:bindings[i].id,position:i},column:1});values.push(nodes.length-1);}
   let sum=values[0];for(const right of values.slice(1)){nodes.push(scalar(address(sum),address(right)));sum=nodes.length-1;}
   return {bindings,nodes,outputs:[{id:randomUUID(),name:'Input total',node:address(sum)}]};
  });
  const late=await request('calculation-graph-page',{ref:g.ref,collection:'bindings',offset:16,limit:16});assert.equal(late.total,17);assert.equal(late.items.length,1);assert.deepEqual(late.items[0].source,sources[16]);
  g.ref=(await request('calculation-graph-change',{ref:g.ref,collection:'bindings',offset:16,item:{...late.items[0],match:{...late.items[0].match,unmatched:'keep'}}})).ref;
  const result=await retain(g.ref,'All seventeen inputs'),retained=await table(result);assert.equal(retained.rows[0].cells[0],'170/1');assert.match(retained.html,/<td>170\/1<\/td>/);
  const detail=await request('measurement-inspect',{source:{ref:result,selector:{kind:'cell',page:0,row:0,column:0}},lineageOffset:16});assert.equal(detail.lineage.total,17);assert.deepEqual(detail.lineage.items[0].sources[0].ref,sources[16]);assert.equal(detail.lineage.items[0].sources[0].selector.column,1);
  stage('input bindings',{bindings:17,distinctRevisions:17,originalArtifacts:1,result:'170/1'});
 });

 let wide;const wideSource=async()=>wide??=await dataset([Object.fromEntries(Array.from({length:129},(_,i)=>['C'+i,i+1]))],Array.from({length:129},(_,i)=>column('C'+i)),'provenance.json');
 await t.test('a deep narrow recipe grows independently of provenance and row count',async()=>{
  await wideSource();const g=await graph(wide.ref,'Deep narrow recipe',async first=>{
   const nodes=[{id:randomUUID(),kind:'column',binding:{id:first.id,position:0},column:0},constant()],address=position=>({id:nodes[position].id,position});let value=0;
   for(let i=0;i<129;i++){nodes.push(scalar(address(value),address(1)));value=nodes.length-1;}
   return {nodes,outputs:[{id:randomUUID(),name:'Deep value',node:address(value)}]};
  });
  const late=await request('calculation-graph-page',{ref:g.ref,collection:'nodes',offset:128,limit:16});assert.equal(late.total,131);assert.equal(late.items.length,3);
  const result=await retain(g.ref,'Deep result'),retained=await table(result);assert.equal(retained.rows[0].cells[0],'130/1');assert.match(retained.html,/<td>130\/1<\/td>/);
  const detail=await request('measurement-inspect',{source:{ref:result,selector:{kind:'cell',page:0,row:0,column:0}}});assert.equal(detail.lineage.total,1);assert.deepEqual(detail.lineage.items[0].sources[0],{ref:wide.ref,selector:{kind:'cell',page:0,row:0,column:0}});
  stage('recipe depth',{operations:129,provenanceLeaves:1,rows:1});
 });

 await t.test('balanced provenance grows beyond a leaf page without a deep recipe',async()=>{
  await wideSource();const g=await graph(wide.ref,'Balanced provenance',async first=>{
   const nodes=Array.from({length:129},(_,i)=>({id:randomUUID(),kind:'column',binding:{id:first.id,position:0},column:i})),address=position=>({id:nodes[position].id,position});let level=nodes.map((_,i)=>i),depth=0;
   while(level.length>1){const next=[];for(let i=0;i<level.length;i+=2){if(i+1===level.length)next.push(level[i]);else{nodes.push(scalar(address(level[i]),address(level[i+1])));next.push(nodes.length-1);}}level=next;depth++;}
   assert.equal(depth,8);return {nodes,outputs:[{id:randomUUID(),name:'All provenance',node:address(level[0])}]};
  });
  const result=await retain(g.ref,'Broad provenance result'),reopened=new ResearchMaterials(new Workspace(f.workspace.root,f.vault)),retained=await table(result,{reader:reopened});assert.equal(retained.rows[0].cells[0],'8385/1');assert.match(retained.html,/<td>8385\/1<\/td>/);
  const leaves=[];let offset=0;do{const detail=await reopened.measurements.inspect({ref:result,selector:{kind:'cell',page:0,row:0,column:0}},{lineageOffset:offset});assert.equal(detail.lineage.total,129);assert.ok(detail.lineage.items.length<=16);leaves.push(...detail.lineage.items);offset=detail.lineage.next;}while(offset!==null);
  assert.deepEqual(leaves.map(item=>item.column),Array.from({length:129},(_,i)=>i));for(const item of leaves)assert.deepEqual(item.sources[0],{ref:wide.ref,selector:{kind:'cell',page:0,row:0,column:item.column}});
  const original=await reopened.measurements.inspect(leaves.at(-1).sources[0]);assert.equal(original.original.selector.pointer,'/rows/0/C128');
  stage('provenance breadth',{leaves:129,operationDepth:8,rows:1,pages:9});
 });

 await t.test('late all-excluded groups retain their counts, source states and complete exported rows',async()=>{
  const values=[{Group:'G0',Reading:5},{Group:'G0',Reading:null},{Group:'G0'},{Group:'G0',Reading:''},...Array.from({length:63},(_,i)=>({Group:'G'+(i+1),Reading:i+1})),{Group:'G64',Reading:901},{Group:'G64',Reading:902}],source=await dataset(values,[column('Group','text'),column('Reading')],'groups.json'),last=await m.datasetPage(source.ref,1),exclusions=Object.fromEntries(last.rows.filter(row=>row.cells[0]==='G64').map(row=>[row.id,'Excluded group observation']));
  assert.equal(Object.keys(exclusions).length,2);const filtered=await m.dataset({recordId,title:'Reviewed groups',id:source.ref.id,expectedRevision:source.ref.revision,artifact:source.artifact,baseDataset:source.ref,exclusions},{signal:t.signal}),original=await table(filtered);assert.deepEqual(original.rows.slice(0,4).map(row=>row.presence[1]),['value','null','absent','missing']);assert.match(original.html,/<td>Declared null<\/td>/);assert.match(original.html,/<td>Absent<\/td>/);assert.match(original.html,/<td>Missing<\/td>/);assert.equal(original.rows.length,69);
  const result=await m.dataset({recordId,title:'Complete grouped results',aggregation:{version:1,source:filtered,keys:[0],values:[{column:1,operation:'sum',name:'Sum'},{column:1,operation:'count',name:'Count'}],missing:'skip',note:'Retain groups even when every source observation is excluded.'}},{signal:t.signal}),retained=await table(result);
  assert.equal(retained.rows.length,65);assert.deepEqual(retained.rows.at(-1).cells,['G64','','0']);assert.deepEqual(retained.rows.at(-1).presence,['value','absent','value']);assert.match(retained.html,/<td>G64<\/td><td>Absent<\/td><td>0<\/td>/);
  const late=await request('retained-table',{ref:result,table:retained.retained,offset:64,limit:16});assert.equal(late.table.rows.length,1);assert.equal(late.table.rows[0].cells[0],'G64');
  const detail=await request('measurement-inspect',{source:{ref:result,selector:{kind:'cell',page:1,row:0,column:1}}});assert.deepEqual(detail.aggregation.counts,{included:0,excluded:2,missing:0,total:2});assert.deepEqual(detail.aggregation.members.map(item=>item.status),['excluded','excluded']);assert.deepEqual(detail.aggregation.members.map(item=>item.value),['901','902']);assert.ok(detail.aggregation.members.every(item=>item.reason==='Excluded group observation'&&item.source.ref.revision===filtered.revision));assert.deepEqual(detail.aggregation.members.map(item=>item.source.selector),[{kind:'cell',page:1,row:3,column:1},{kind:'cell',page:1,row:4,column:1}]);
  const missing=await request('measurement-inspect',{source:{ref:result,selector:{kind:'cell',page:0,row:0,column:1}}});assert.deepEqual(missing.aggregation.members.map(item=>item.presence),['value','null','absent','missing']);assert.deepEqual(missing.aggregation.counts,{included:1,excluded:0,missing:3,total:4});
  stage('all-excluded late group',{groups:65,sourceRows:69,lastSourcePage:1,lastResultPage:1});
 });

 await t.test('cancellation during graph row execution retries the same job without losing presence or source positions',async()=>{
  const values=Array.from({length:65},(_,i)=>i===0?{Value:null}:i===1?{}:i===2?{Value:''}:{Value:i}),source=await dataset(values,[column('Value')],'interruption.json'),initial=await m.datasetPage(source.ref,0),filtered=await m.dataset({recordId,title:'Excluded graph source',id:source.ref.id,expectedRevision:source.ref.revision,baseDataset:source.ref,artifact:source.artifact,exclusions:{[initial.rows[3].id]:'Excluded source observation'}},{signal:t.signal});
  const g=await graph(filtered,'Interruptible small graph',async first=>{const node={id:randomUUID(),kind:'column',binding:{id:first.id,position:0},column:0};return {nodes:[node],outputs:[{id:randomUUID(),name:'Reading',node:{id:node.id,position:0}}]};});
  const id=randomUUID(),command={recordId,title:'Interrupted graph result',calculation:{version:4,graph:g.ref}},queued=await enqueueDataset(m,jobs.queue,command,id),first=await jobs.queue.claim(),controller=new AbortController();let stoppedAt=0;
  await assert.rejects(leased(first,()=>jobs.queue.definition(first).prepare(first,{signal:controller.signal,progress:async progress=>{if(progress.stage==='Calculating retained graph rows'&&progress.done===64){stoppedAt=progress.done;await jobs.queue.control(id,'cancel');controller.abort();}}})),{name:'AbortError'});
  assert.equal(stoppedAt,64);assert.equal(await m.current(id),null);await jobs.queue.release(id,first.lease.token);assert.equal((await jobs.queue.read(id)).state,'cancelled');await jobs.queue.control(id,'retry');const retry=await jobs.queue.claim();assert.equal(retry.id,queued.id);assert.deepEqual(retry.input,first.input);
  const prepared=await leased(retry,()=>jobs.queue.definition(retry).prepare(retry,{signal:t.signal}));await assert.rejects(jobs.queue.complete(id,first.lease.token,prepared),{code:'JOB_LEASE'});const result=(await jobs.queue.complete(id,retry.lease.token,prepared)).result,retained=await table(result);
  assert.equal(retained.rows.length,65);assert.deepEqual(retained.rows.slice(0,4).map(row=>row.presence[0]),['null','absent','missing','absent']);assert.equal(retained.rows[3].exclusion,'Excluded source observation');assert.equal(retained.rows.at(-1).cells[0],'64');assert.match(retained.html,/<td>64<\/td>/);assert.match(retained.html,/Excluded source observation/);
  const detail=await request('measurement-inspect',{source:{ref:result,selector:{kind:'cell',page:1,row:0,column:0}}});assert.deepEqual(detail.lineage.items[0].sources[0],{ref:filtered,selector:{kind:'cell',page:1,row:0,column:0}});
  const original=await request('measurement-inspect',{source:detail.lineage.items[0].sources[0]});assert.equal(original.original.selector.pointer,'/rows/64/Value');
  const excluded=await request('measurement-inspect',{source:{ref:result,selector:{kind:'cell',page:0,row:3,column:0}}}),excludedOriginal=await request('measurement-inspect',{source:excluded.lineage.items[0].sources[0]});assert.equal(excludedOriginal.value.spelling,'3');assert.equal(excludedOriginal.row.excluded,'Excluded source observation');
  assert.equal((await enqueueDataset(m,jobs.queue,command,id)).result.revision,result.revision);stage('graph interruption',{rows:65,interruptedAfter:stoppedAt,nodes:1,outputs:1,retriedSameJob:true});
 });
});
