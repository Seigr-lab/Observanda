import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {clearVault} from '../src/encryption.js';
import {blankAnalysisMethod,blankAnalysisSource,validComparison} from '../src/web/analysis-model.js';
import {AnalysisPublicationReview} from '../src/analysis-publication-review.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {contentBuffer} from '../src/file-content.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueueComparison,datasetJobs} from '../src/dataset-jobs.js';
import {LocalExport} from '../src/local-export.js';
import {AppError} from '../src/errors.js';
const col=(name,representation='text')=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'none',reference:'',resolution:'',uncertainty:''}});
const columns=[col('key'),col('value','integer'),col('status'),col('lower','integer'),col('upper','integer'),col('exclusion'),col('before'),col('after'),col('concurrent')];
async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-analysis-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const upload=async(name,text)=>{const bytes=Buffer.from(text),s=await m.startImport({recordId,name,size:bytes.length});await m.appendImport(s.id,0,[bytes]);return m.finishImport(s.id);};
 const one=await upload('first.csv','key,value,status,lower,upper,exclusion,before,after,concurrent\na,9007199254740993,correct,9007199254740992,9007199254740994,,idle,request,read\nb,9007199254740995,mismatched,9007199254740992,9007199254740994,,request,return,write\nc,,correct,9007199254740992,9007199254740994,,return,,read\nd,0,excluded,-1,1,Declared warmup,,,\ne,1,unresolved,0,2,,,,');
 const two=await upload('second.csv','key,value,status,lower,upper,exclusion,before,after,concurrent\na,2,correct,1,3,,,,\nb,4,mismatched,1,3,,,,');
 const first=await m.dataset({recordId,title:'Run one observations',artifact:one,columns}),second=await m.dataset({recordId,title:'Run two observations',artifact:two,columns});
 const sources=[first,second].map(dataset=>{const s=blankAnalysisSource(dataset);Object.assign(s.columns,{value:1,status:2,lower:3,upper:4,exclusion:5,sequence:0,before:6,after:7,concurrent:8});return s;});
 sources[0].run=await m.pinRecord(book.entries[0].id,recordRevision(book.entries[0]));sources[1].run=await m.pinRecord(book.entries[1].id,recordRevision(book.entries[1]));sources[0].membership='training';sources[1].membership='held-out';sources[0].windowRelation='overlapping';sources[1].windowRelation='disjoint';sources[1].profile='alternate';
 const method={...blankAnalysisMethod(),references:{toolSource:one,decoder:null,calibration:two},uncertainty:'Unknown instrument uncertainty; exact arithmetic over retained spellings.',limitations:'Synthetic evidence. No claim of independent readings or causal effect.'};
 const command={recordId,title:'Two run comparison',tool:'External fixture decoder',version:'sha256-pinned source',method,comparison:{version:1,sources,ordering:'source',expected:null}};
 return {...f,directory,book,m,recordId,upload,first,second,one,two,command};
}
test('two-run comparison preserves exception denominators, exact margins, context and predecessor identity',async t=>{
 const f=await fixture(t),read=ResearchCatalogue.prototype.read;ResearchCatalogue.prototype.read=()=>{throw Error('Unrelated record bodies loaded');};t.after(()=>ResearchCatalogue.prototype.read=read);
 const ref=await f.m.comparisons.save({...f.command,id:randomUUID()}),doc=await f.m.read(ref),s=doc.content.summary;
 const groups=(await f.m.comparisons.page({ref,view:'groups'})).items;
 assert.deepEqual(s.raw,{correct:2,mismatched:2,unresolved:1,unavailable:1,excluded:1});assert.equal(s.rows,7);assert.equal(s.runs,2);assert.deepEqual(groups.map(g=>[g.successful,g.assessed]),[[1,2],[1,2]]);assert.equal(groups[0].windowRelation,'overlapping');assert.equal(groups[1].membership,'held-out');
 const boundary=await f.m.comparisons.page({ref,view:'boundary'}),outlier=boundary.items.find(o=>o.category==='mismatched');assert.equal(outlier.value,'9007199254740995');assert.deepEqual(outlier.margin,{numerator:'-1',denominator:'1'});assert.equal(outlier.upper,'9007199254740994');assert.equal(outlier.after,'return');
 const inspected=await f.m.measurements.inspect(outlier.locator);assert.equal(inspected.value.spelling,'9007199254740995');assert.equal(inspected.original.ref.revision,f.one.revision);assert.match((await f.m.measurements.inspect(inspected.original)).text,/9007199254740995/);
 assert.ok((await f.m.comparisons.page({ref,view:'distribution'})).items.some(v=>v.exact?.numerator==='9007199254740993'));assert.ok((await f.m.comparisons.page({ref,view:'transitions'})).items.some(t=>t.from==='mismatched'&&t.to==='unavailable'));
 const revised=await f.m.comparisons.save({...f.command,id:ref.id,expectedRevision:ref.revision,method:{...f.command.method,limitations:'Narrowed applicability; retain original band and exceptions.'}});assert.equal((await f.m.read(revised)).previous,ref.revision);assert.deepEqual((await f.m.read(ref)).content.summary,s);
 await assert.rejects(f.m.comparisons.save({...f.command,id:ref.id,expectedRevision:ref.revision}),{code:'MATERIAL_CHANGED'});
 const invalid=structuredClone(f.command);invalid.comparison.sources[0].statuses.correct='unknown-token';await assert.rejects(f.m.comparisons.save(invalid),{code:'ANALYSIS_MAPPING'});
 const controller=new AbortController();controller.abort();await assert.rejects(f.m.comparisons.save(f.command,{signal:controller.signal}),{name:'AbortError'});
});
test('independent expected fixtures preserve unmatched rows, missing values and exclusions',async t=>{
 const f=await fixture(t),artifact=await f.upload('expected.csv','key,value\na,9007199254740993\nb,9007199254740994\nc,0\nd,0\ne,1\nf,2'),expected=await f.m.dataset({recordId:f.recordId,title:'Independent expected',artifact,columns:[col('key'),col('value','integer')]});
 const command={...f.command,comparison:{...f.command.comparison,expected:{dataset:expected,source:0,actualKey:0,key:0,value:1,rationale:'Hand-calculated fixture with one deliberate mismatch and extra expected row.'}}};
 const ref=await f.m.comparisons.save(command),v=(await f.m.read(ref)).content.summary.verification;assert.equal(v.correct,2);assert.equal(v.mismatched,1);assert.equal(v.unavailable,1);assert.equal(v.excluded,1);assert.equal(v.unmatched,1);
 const aggregate=structuredClone(f.command);aggregate.comparison.sources.forEach(s=>s.evidence='aggregate');aggregate.comparison.ordering='unknown';const aggregateRef=await f.m.comparisons.save(aggregate),a=(await f.m.read(aggregateRef)).content.summary;assert.equal(a.aggregate.correct,2);assert.equal(a.raw.correct,0);assert.ok((await f.m.comparisons.page({ref:aggregateRef,view:'groups'})).items.every(g=>g.assessed===0));assert.equal(a.counts.transitions,0);
 assert.equal(validComparison({...command.comparison,sources:[]}),false);
 assert.equal(validComparison({...command.comparison,sources:[command.comparison.sources[0],command.comparison.sources[0]]}),false);
});
test('result statements retain sources, stale editions require dispositions and later input changes revoke admission',async t=>{
 const f=await fixture(t),analysis=await f.m.comparisons.save(f.command),records=new ResearchRecords(f.workspace,{}),conclusion=f.book.entries[2];
 const result={id:randomUUID(),kind:'conclusion',title:'Observed result',text:'Two of four assessed raw readings match. Exceptions remain visible.',basis:'retained',source:{...analysis,label:'PRIVATE_ANALYSIS_TITLE'},limitations:'Synthetic tests; overlapping readings are not independent runs.'};
 await records.save({workspaceId:f.book.id,changes:[{id:conclusion.id,expectedRevision:recordRevision(conclusion),record:{...conclusion,share:true,results:{version:1,statements:[result]}}}]},{compact:true});
 const firstDoc=await f.m.read(f.first);await f.m.dataset({recordId:f.recordId,title:firstDoc.title,id:f.first.id,expectedRevision:f.first.revision,artifact:f.one,baseDataset:f.first,columnChanges:[{index:1,column:{...columns[1],unit:'count'}}]});
 const releases=new PublicationJobs(f.workspace),candidate=await releases.inline({etag:(await f.workspace.outline()).etag}),review=new AnalysisPublicationReview(f.workspace);
 assert.equal(candidate.researchReview.analysis.items.length,1);await assert.rejects(review.assert(candidate),{code:'ANALYSIS_REVIEW'});
 const local=new LocalExport(f.workspace);await assert.rejects(local.candidate(candidate.reviewId),{code:'ANALYSIS_REVIEW'});
 const html=await contentBuffer(candidate.files.get('entries/'+conclusion.id+'.html'));assert.ok(html.includes(Buffer.from(result.text)));assert.ok(!html.includes(Buffer.from('PRIVATE_ANALYSIS_TITLE')));assert.ok(!html.includes(Buffer.from(f.one.id)));assert.ok(html.includes(Buffer.from('Supporting analysis retained privately')));
 await assert.rejects(review.save(candidate,[{id:candidate.researchReview.analysis.items[0].id,reason:''}]),{code:'ANALYSIS_REVIEW'});
 await review.save(candidate,candidate.researchReview.analysis.items.map(i=>({id:i.id,reason:'This edition explicitly reports the original count interpretation; the revised schema does not replace that historical result.'})));await review.assert(candidate);
 assert.equal((await local.candidate(candidate.reviewId)).id,candidate.id);
 const receiptFile=review.file(candidate.reviewId),receipt=await f.workspace.readMetadata(receiptFile,1024*1024);
 await f.workspace.withLock(()=>f.workspace.writeMetadata(receiptFile,JSON.stringify({...JSON.parse(receipt),decisions:[]})));
 await assert.rejects(review.assert(candidate),{code:'CATALOGUE_DAMAGED'});
 await f.workspace.withLock(()=>f.workspace.writeMetadata(receiptFile,receipt));
 const current=await f.m.current(f.first.id);await f.m.dataset({recordId:f.recordId,title:firstDoc.title,id:current.id,expectedRevision:current.revision,artifact:f.one,baseDataset:current,columnChanges:[{index:1,column:{...columns[1],unit:'ticks'}}]});await assert.rejects(review.assert(candidate),{code:'ANALYSIS_REVIEW'});
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copied,f.vault));assert.deepEqual(await restored.read(analysis),await f.m.read(analysis));assert.deepEqual(await contentBuffer((await restored.artifact(f.one)).content),await contentBuffer((await f.m.artifact(f.one)).content));await restored.verify();
});

test('comparison jobs fence interrupted commits, cancellation, retries and stale workers',async t=>{
 const f=await fixture(t),{queue,worker}=workspaceJobs(f.workspace);t.after(()=>worker.stop());const id=randomUUID();
 const queued=await enqueueComparison(f.m,queue,f.command,id);assert.deepEqual(await enqueueComparison(f.m,queue,f.command,id),queued);
 const first=await queue.claim(),definition=queue.definition(first),prepared=await definition.prepare(first,{}),commit=definition.commit;
 definition.commit=async(...args)=>{await commit(...args);throw new AppError('STORAGE_FULL');};
 await assert.rejects(queue.complete(id,first.lease.token,prepared),{code:'STORAGE_FULL'});definition.commit=commit;
 assert.equal(await f.m.current(id),null);assert.equal((await queue.read(id)).state,'running');
 await queue.control(id,'cancel');await assert.rejects(queue.complete(id,first.lease.token,prepared),{code:'JOB_CANCELLED'});await queue.release(id,first.lease.token);
 await queue.control(id,'retry');const claim=await queue.claim(),next=await queue.definition(claim).prepare(claim,{});
 await assert.rejects(queue.complete(id,first.lease.token,next),{code:'JOB_LEASE'});const done=await queue.complete(id,claim.lease.token,next);
 assert.equal(done.state,'completed');assert.equal((await f.m.current(id)).revision,done.result.revision);assert.equal((await datasetJobs(f.m,queue,f.recordId)).items[0].type,'analysis.compare');
 assert.equal((await f.m.read(done.result)).content.summary.rows,7);
});

test('external analyses retain structured tool, calibration and parameter provenance through resumable intake',async t=>{
 const f=await fixture(t),method={...f.command.method,parameters:[{name:'Acceptance band',value:'[1,3]',unit:'',reference:f.second,reason:'Declared before assessing the fixture.'}]};
 const command={kind:'analysis',recordId:f.recordId,title:'External verification',tool:'Independent decoder',version:'fixture-v1',parameters:'No execution inside Observanda.',method,totals:{inputs:1,outputs:1}},draft=await f.m.drafts.start(command);
 await f.m.drafts.append({id:draft.id,items:[f.first],offset:0});await f.m.drafts.append({id:draft.id,items:[f.two],slot:'outputs',offset:0});
 const ref=await f.m.drafts.finish(draft.id);assert.deepEqual((await f.m.read(ref)).content.method,method);
 const refs=await Array.fromAsync(f.m.index.iterInputs(ref));for(const r of [f.one,f.two,f.second])assert.ok(refs.some(v=>v.id===r.id&&v.revision===r.revision));
 await f.m.verify();
 const tooLarge={...method,parameters:Array.from({length:64},(_,i)=>({name:'P'+i,value:'x'.repeat(8192),unit:'',reference:null,reason:''}))};
 await assert.rejects(f.m.drafts.start({...command,method:tooLarge}),{code:'ANALYSIS_LIMIT'});
 const owner=f.m.assertOwner;f.m.assertOwner=()=>{throw Error('Historical verification required a current owner');};
 try{const comparison=await f.m.comparisons.prepare(f.command,{retained:true});assert.equal(comparison.content.summary.rows,7);}finally{f.m.assertOwner=owner;}
});

test('criterion assessments participate in changed-analysis review without copying their evidence into public output',async t=>{
 const f=await fixture(t),analysis=await f.m.comparisons.save(f.command),record=f.book.entries[1],preparationId=randomUUID(),criterionId=randomUUID(),recordedAt=new Date().toISOString();
 const attempt={version:1,events:[],preparations:[{id:preparationId,supersedes:null,recordedAt,reason:'',applicability:'Declared original readings',basedOn:null,protocols:[],conditions:[],inputs:[],observations:[],criteria:[{id:criterionId,label:'Signal matches',expected:'All acquired values',comparator:'Exact declared value',denominator:'Acquired values',scope:'prospective',reason:''}]}],
  assessments:[{id:randomUUID(),supersedes:null,recordedAt,reason:'Review of retained comparison',preparationId,criterionId,outcome:'not-met',domainOutcome:'',observed:'Two mismatches',denominator:'Four assessed raw readings',actor:'',source:'',time:{meaning:'unknown',value:''},references:[{...analysis,workspaceId:f.book.id,label:'PRIVATE_ANALYSIS_ASSESSMENT'}]}]};
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,attempt}}]});
 await f.m.comparisons.save({...f.command,id:analysis.id,expectedRevision:analysis.revision,method:{...f.command.method,limitations:'Revised interpretation'}});
 const candidate=await new PublicationJobs(f.workspace).inline({etag:(await f.workspace.outline()).etag}),items=candidate.researchReview.analysis.items;
 assert.equal(items.length,1);assert.equal(items[0].assessmentId,attempt.assessments[0].id);assert.equal(items[0].label,'Signal matches');
 const html=await contentBuffer(candidate.files.get('entries/'+record.id+'.html'));assert.ok(!html.includes(Buffer.from('PRIVATE_ANALYSIS_ASSESSMENT')));assert.ok(html.includes(Buffer.from('Two mismatches')));
 await assert.rejects(new AnalysisPublicationReview(f.workspace).assert(candidate),{code:'ANALYSIS_REVIEW'});
});
