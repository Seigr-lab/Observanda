import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {clearVault} from '../src/encryption.js';
import {DatasetCalculations} from '../src/dataset-calculations.js';
import {blankAnalysisMethod,blankAnalysisSource} from '../src/web/analysis-model.js';
import {enqueueDataset} from '../src/dataset-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {calculateStep,validOperand} from '../src/web/dataset-calculation-model.js';
import {retainedTable} from '../src/retained-tables.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {createFigure} from '../src/web/figure-model.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {contentBuffer} from '../src/file-content.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {AnalysisPublicationReview} from '../src/analysis-publication-review.js';
const col=(name,representation='text',unit='')=>({...defaultColumn({label:name}),representation,unit});
const constant=(constant,unit='')=>({constant,unit}),column=column=>({column});
const condition=(left,operator,right)=>({left,operator,right});
const step=(name,operation,left,right=null,unit='',test=null)=>({name,operation,left,right,unit,condition:test});
const recipe=source=>({version:1,source,view:'observations',joins:[],steps:[],where:null,selectionReason:'',calibration:null,note:''});
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-calculations-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),recordId=(await f.workspace.read()).book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const dataset=async(text,columns)=>{const bytes=Buffer.from(text),upload=await m.startImport({recordId,name:'acquisition.csv',size:bytes.length});for(let i=0;i<bytes.length;i+=EVIDENCE_CHUNK)await m.appendImport(upload.id,i/EVIDENCE_CHUNK,[bytes.subarray(i,i+EVIDENCE_CHUNK)]);const artifact=await m.finishImport(upload.id);return m.dataset({recordId,title:'Acquisitions',artifact,columns});};
 return {...f,m,recordId,dataset};
}
test('derived values feed figures and verified publication tables while revisions, original files and other columns stay private',async t=>{
 const f=await fixture(t),source=await f.dataset('key,ticks,private\na,3,PRIVATE_SENTINEL\nb,6,PRIVATE_SENTINEL',[col('key'),col('ticks','integer','ticks'),col('private')]),c=recipe(source);c.steps=[step('Duration','divide',column(1),constant('5','Hz'),'s')];
 const derived=await f.m.dataset({recordId:f.recordId,title:'PRIVATE_DERIVED',calculation:c}),selection={columns:[0,3],offset:0,count:20,includeExcluded:false},table=await retainedTable(f.m,{ref:derived,selection});assert.equal(table.rows[0].cells[1],'3/5');
 const figure=await f.m.plot({recordId:f.recordId,title:'Durations',dataset:derived,base:createFigure(),mapping:{x:0,xKind:'category',values:[{column:3,error:null}],group:null,operation:'raw',order:'source',kind:'bar',numericPolicy:'safe'}});assert.equal(figure.figure.series[0].points[0].y,0.6);
 const snapshot=await f.workspace.read(),record=snapshot.book.entries.find(r=>r.id===f.recordId),result={id:randomUUID(),kind:'table',basis:'retained',source:derived,title:'Durations',text:'Exact durations calculated from retained counts.',limitations:'Synthetic source only.',table},next={...record,share:true,results:{version:1,statements:[result]}};
 const bad=structuredClone(next);bad.results.statements[0].table.rows[0].cells[1]='100';const records=new ResearchRecords(f.workspace,{});
 await assert.rejects(records.save({workspaceId:snapshot.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:bad}]}),{code:'DATASET_TABLE'});
 await records.save({workspaceId:snapshot.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:next}]});
 const candidate=await new PublicationJobs(f.workspace).inline({etag:(await f.workspace.outline()).etag}),html=(await contentBuffer(candidate.files.get('entries/'+record.id+'.html'))).toString();assert.match(html,/3\/5/);assert.match(html,/retained-result-table/);assert.ok(!html.includes('PRIVATE_SENTINEL'));assert.ok(!html.includes('PRIVATE_DERIVED'));assert.ok(!html.includes(source.id));
 const prior=await f.m.read(derived),recipe2=structuredClone(c);recipe2.steps[0].right=constant('10','Hz');await f.m.dataset({recordId:f.recordId,title:prior.title,id:derived.id,expectedRevision:derived.revision,calculation:recipe2});await assert.rejects(new AnalysisPublicationReview(f.workspace).assert(candidate),{code:'ANALYSIS_REVIEW'});
 const restoredRoot=await copyWorkspace(await copyPlan(f.workspace.root,path.join(path.dirname(f.workspace.root),'restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(restoredRoot,f.vault));assert.deepEqual(await retainedTable(restored,{ref:derived,selection}),table);await restored.verify();
});
test('paired calculations preserve exact counters, calibration, exclusions and inspectable input cells over bounded pages',async t=>{
 const f=await fixture(t),columns=[col('Visit'),col('Stage'),col('Counter','integer','ticks'),...Array.from({length:33},(_,i)=>col('Context '+i))];
 const text='Visit,Stage,Counter,'+columns.slice(3).map(c=>c.name).join(',')+'\n'+Array.from({length:1100},(_,i)=>['before','after'].map(stage=>[i,stage,90071992547409930000n+BigInt(i)+(stage==='after'?7n:0n),...columns.slice(3).map(()=> 'retained context')].join(',')).join('\n')).join('\n');
 assert.ok(Buffer.byteLength(text)>262144);const source=await f.dataset(text,columns),calibration=await f.dataset('frequency\n3',[col('frequency','integer','Hz')]);
 const c=recipe(source);c.calibration=calibration;c.joins=[{dataset:source,keys:[{left:0,right:0}],where:condition(column(1),'eq',constant('before')),unmatched:'error'}];c.where=condition(column(1),'eq',constant('after'));c.selectionReason='Before stage supplies the paired baseline';c.steps=[step('Difference','subtract',column(2),column(columns.length+2),'ticks'),step('Duration','divide',column(columns.length*2),constant('3','Hz'),'s')];
 const command={recordId:f.recordId,title:'Paired durations',calculation:c},preview=await f.m.previewDataset(command);assert.equal(preview.rows[1].cells.at(-1),'7/3');
 const ref=await f.m.dataset(command),doc=await f.m.read(ref);assert.equal(doc.content.rowCount,2200);assert.deepEqual(doc.content.calculation,c);assert.equal(doc.content.algorithmVersion,1);
 const data=await f.m.datasetPage(ref),row=data.rows[1];assert.equal(row.cells[2],'90071992547409930007');assert.equal(row.cells.at(-1),'7/3');assert.equal(data.rows[0].excluded,c.selectionReason);assert.equal(data.rows[0].valueKinds.at(-1),'absent');assert.equal(new Set(data.rows.map(r=>r.id)).size,data.rows.length);
 const inspection=await f.m.measurements.inspect({ref,selector:{kind:'cell',page:0,row:1,column:columns.length*2+1}});assert.deepEqual(inspection.exact,{numerator:'7',denominator:'3'});assert.equal(inspection.derivedSources.length,2);assert.deepEqual(inspection.derivedSources.map(s=>s.selector.row),[1,0]);
 const revised=await f.m.dataset({recordId:f.recordId,title:doc.title,id:ref.id,expectedRevision:ref.revision,artifact:source,baseDataset:ref,exclusions:{[row.id]:'Review exclusion'}});assert.equal((await f.m.datasetPage(revised)).rows[1].excluded,'Review exclusion');assert.equal((await f.m.datasetPage(ref)).rows[1].excluded,null);assert.deepEqual((await f.m.read(revised)).content.calculation,c);
 const next=structuredClone(c);next.steps[1].right=constant('6','Hz');const recalculated=await f.m.dataset({...command,id:ref.id,expectedRevision:revised.revision,calculation:next});assert.equal((await f.m.datasetPage(recalculated)).rows[1].cells.at(-1),'7/6');assert.equal((await f.m.datasetPage(ref)).rows[1].cells.at(-1),'7/3');await f.m.verify();
});
test('calculation failures do not publish partial datasets and unknown conditions stay absent',async t=>{
 const f=await fixture(t),source=await f.dataset('key,value\na,5\na,6',[col('key'),col('value','integer')]),c=recipe(source),command={recordId:f.recordId,id:randomUUID(),expectedRevision:null,title:'Failure',calculation:c};
 c.joins=[{dataset:source,keys:[{left:0,right:0}],where:null,unmatched:'error'}];await assert.rejects(f.m.dataset(command),{code:'DATASET_JOIN_DUPLICATE'});assert.equal(await f.m.current(command.id),null);
 c.joins=[];c.steps=[step('Ratio','divide',column(1),constant('0'))];await assert.rejects(f.m.dataset(command),{code:'DATASET_CALCULATION'});assert.equal(await f.m.current(command.id),null);
 c.steps=[step('Sum','add',column(1),constant('2','seconds'))];await assert.rejects(f.m.dataset(command),{code:'DATASET_CALCULATION'});
 const choose=step('Choice','choose',constant('1'),constant('0'),'',condition(column(0),'eq',constant('yes')));assert.equal(calculateStep(choose,{cells:[''],valueKinds:['absent']},[col('condition')]).kind,'absent');
 const controller=new AbortController();controller.abort();await assert.rejects(f.m.previewDataset({...command,calculation:recipe(source)},{signal:controller.signal}),{name:'AbortError'});
});

test('typed constants retain their numeral context through calculation, recalculation, plots and backup',async t=>{
 const f=await fixture(t),source=await f.dataset('state,value\na,10\nb,0.1',[col('state'),{...col('value','radix-fraction'),radix:6}]),c=recipe(source);
 c.steps=[step('Sum','add',column(1),{constant:'10',unit:'',representation:'radix',radix:6}),step('Half','multiply',column(1),{constant:'1/2',unit:'',representation:'rational',radix:10})];
 const result=await f.m.dataset({recordId:f.recordId,title:'Declared-base calculations',calculation:c}),page=await f.m.datasetPage(result);
 assert.deepEqual(page.rows.map(r=>r.cells.slice(2)),[['12/1','3/1'],['37/6','1/12']]);
 assert.deepEqual((await f.m.read(result)).content.calculation,c);
 const inspected=await f.m.measurements.inspect({ref:result,selector:{kind:'cell',page:0,row:1,column:2}});assert.deepEqual(inspected.exact,{numerator:'37',denominator:'6'});assert.equal(inspected.derivedSources[0].ref.id,source.id);
 const table=await retainedTable(f.m,{ref:result,selection:{columns:[0,2,3],offset:0,count:20,includeExcluded:false}});assert.equal(table.rows[1].cells[1],'37/6');
 const legacy=structuredClone(c);legacy.steps[0].right=constant('10');const next=await f.m.dataset({recordId:f.recordId,title:'Decimal reinterpretation explicitly revised',id:result.id,expectedRevision:result.revision,calculation:legacy});assert.equal((await f.m.datasetPage(next)).rows[0].cells[2],'16/1');assert.equal((await f.m.datasetPage(result)).rows[0].cells[2],'12/1');
 const numeric=await f.dataset('state,value\na,10\nb,20',[col('state'),{...col('value','radix'),radix:6}]);const plot=await f.m.plot({recordId:f.recordId,title:'Exact senary coordinates',dataset:numeric,base:createFigure(),mapping:{x:0,xKind:'category',values:[{column:1,error:null}],group:null,operation:'raw',order:'source',kind:'bar',numericPolicy:'safe'}});assert.deepEqual(plot.figure.series[0].points.map(p=>p.y),[6,12]);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(path.dirname(f.workspace.root),'typed-restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copy,f.vault));assert.deepEqual(await retainedTable(restored,{ref:result,selection:table.selection}),table);assert.deepEqual((await restored.read(result)).content.calculation,c);await restored.verify();
});

test('constant validation distinguishes explicit text, typed numbers and legacy interpretation',()=>{
 for(const value of [{constant:'6',unit:'',representation:'radix',radix:6},{constant:'1',unit:'',representation:'rational',radix:10},{constant:'10',unit:'',representation:'integer',radix:6},{constant:'10',unit:'',radix:6},{constant:'10',unit:'',representation:'radix'}])assert.equal(validOperand(value,2),false);
 for(const value of [{constant:'label',unit:''},{constant:'10',unit:'',representation:'text',radix:10},{constant:'0.1',unit:'',representation:'radix-fraction',radix:6},{constant:'1/6',unit:'',representation:'rational',radix:10}])assert.equal(validOperand(value,2),true);
});

test('numerical joins match exact values across bases, reject ambiguous equivalents and keep lexical keys available',async t=>{
 const f=await fixture(t),left=await f.dataset('Key,Reading\n10,3\n010,5\n0.1,7',[{...col('Key','radix-fraction','s'),radix:6},col('Reading','integer')]),right=await f.dataset('Key,Baseline\n6/1,2\n1/6,4',[col('Key','rational','s'),col('Baseline','integer')]),c=recipe(left);
 c.joins=[{dataset:right,keys:[{left:0,right:0,semantics:'numeric'}],where:null,unmatched:'error'}];c.steps=[step('Difference','subtract',column(1),column(3))];
 const result=await f.m.dataset({recordId:f.recordId,title:'Exact joined values',calculation:c});assert.deepEqual((await f.m.datasetPage(result)).rows.map(r=>r.cells.at(-1)),['1/1','3/1','3/1']);assert.deepEqual((await f.m.read(result)).content.calculation,c);
 const inspection=await f.m.measurements.inspect({ref:result,selector:{kind:'cell',page:0,row:1,column:4}});assert.deepEqual(inspection.derivedSources.map(s=>[s.ref.id,s.selector.row]),[[left.id,1],[right.id,0]]);
 c.joins[0].keys[0].semantics='lexical';await assert.rejects(f.m.dataset({recordId:f.recordId,title:'Lexical mismatch',calculation:c}),{code:'DATASET_JOIN_MISSING'});
 c.joins[0].keys[0].semantics='numeric';c.joins[0].dataset=await f.dataset('Key,Baseline\n6,2\n6.0,4',[col('Key','decimal','s'),col('Baseline','integer')]);await assert.rejects(f.m.dataset({recordId:f.recordId,title:'Ambiguous numeric baseline',calculation:c}),{code:'DATASET_JOIN_DUPLICATE'});
 c.joins[0].dataset=await f.dataset('Key,Baseline\n6,2',[col('Key','integer','ms'),col('Baseline','integer')]);await assert.rejects(f.m.dataset({recordId:f.recordId,title:'Units are not inferred',calculation:c}),{code:'DATASET_JOIN_MISSING'});await f.m.verify();
});
test('comparison observations and distributions become datasets and calculated jobs fence cancellation and retry',async t=>{
 const f=await fixture(t),source=await f.dataset('key,value\na,9007199254740993\nb,9007199254740993',[col('key'),col('value','integer')]),s=blankAnalysisSource(source);s.columns.value=1;
 const comparison=await f.m.comparisons.save({recordId:f.recordId,title:'Comparison',tool:'fixture',version:'1',method:{...blankAnalysisMethod(),unavailable:'Synthetic test source',uncertainty:'Unknown',limitations:'Synthetic qualification only'},comparison:{version:1,sources:[s],ordering:'source',expected:null}}),c=recipe(comparison);
 for(const view of ['observations','distribution','transitions']){c.view=view;const ref=await f.m.dataset({recordId:f.recordId,title:view,calculation:c}),data=await f.m.datasetPage(ref);if(view==='observations')assert.equal(data.rows[0].cells[0],'9007199254740993/1');if(view==='distribution')assert.equal(data.rows[0].cells[3],'2');}
 c.view='observations';const {queue,worker}=workspaceJobs(f.workspace);t.after(()=>worker.stop());const id=randomUUID(),command={recordId:f.recordId,title:'Queued calculation',calculation:c};
 await enqueueDataset(f.m,queue,command,id);const first=await queue.claim(),prepared=await queue.definition(first).prepare(first,{});await queue.control(id,'cancel');await assert.rejects(queue.complete(id,first.lease.token,prepared),{code:'JOB_CANCELLED'});await queue.release(id,first.lease.token);assert.equal(await f.m.current(id),null);
 await queue.control(id,'retry');const second=await queue.claim(),result=await queue.definition(second).prepare(second,{}),done=await queue.complete(id,second.lease.token,result);assert.equal(done.state,'completed');assert.equal((await f.m.read(done.result)).content.rowCount,2);assert.equal((await new DatasetCalculations(f.m).schema(done.result)).length,22);
});
