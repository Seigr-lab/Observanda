import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordValues} from '../src/record-values.js';
import {RetainedRecordDocuments} from '../src/retained-record-documents.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueueDataset,enqueuePlot,datasetJobs} from '../src/dataset-jobs.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {analysisDependencyState} from '../src/analysis-dependencies.js';
import {contentBuffer} from '../src/file-content.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {digest} from '../src/storage-format.js';

function forbid(t){t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Evidence operation reconstructed a record');});t.mock.method(ResearchMaterials.prototype,'owner',()=>{throw Error('Evidence operation asked for a full owner');});const read=RecordValueTree.prototype.read;t.mock.method(RecordValueTree.prototype,'read',async function(ref){const result=await read.call(this,ref);if(result&&typeof result==='object'&&'notebookId'in result&&'sections'in result)throw Error('Evidence operation reconstructed a record root');return result;});}
async function perform(queue,id){const job=await queue.claim();assert.equal(job.id,id);const prepared=await queue.definition(job).prepare(job,{});return queue.complete(job.id,job.lease.token,prepared);}
async function upload(materials,recordId,bytes){const session=await materials.startImport({recordId,name:'readings.csv',size:bytes.length});await materials.appendImport(session.id,0,[bytes]);return {session,ref:await materials.finishImport(session.id)};}

test('large-record evidence intake, data jobs and source review use only selected stored values',async t=>{
 const f=await figureValueFixture({large:true});t.after(f.close);const m=f.materials,recordId=f.record.id,jobs=workspaceJobs(f.workspace);t.after(()=>jobs.worker.stop());forbid(t);
 const bytes=Buffer.from('Group,Reading\nfirst,1\nsecond,2\n'),{session,ref:artifact}=await upload(m,recordId,bytes);
 const retained=JSON.parse(await f.workspace.readMetadata('.observanda/materials/records/'+recordId+'/'+session.acquisition.revision+'.json',1024));assert.equal(retained.format,'observanda-retained-record');assert.equal((await new RetainedRecordDocuments(f.workspace).read({ref:session.acquisition})).previous.header.title,f.record.title);assert.deepEqual(await contentBuffer((await m.artifact(artifact)).content),bytes);assert.deepEqual(await m.imports(recordId),[]);
 const descriptor={name:'readings.csv',size:bytes.length,sourcePath:'returned/current/readings.csv',fingerprint:await fileFingerprint(bytes.length,[{size:bytes.length,sha256:digest(bytes)}],digest)},batch=await m.intakes.start({recordId,title:'Current return',count:1,bytes:bytes.length,sourceMode:'folder',purpose:'current-return'});
 await m.intakes.append({id:batch.id,offset:0,items:[descriptor]});const page=await m.intakes.page({id:batch.id});if(!page.items[0].reuse)await m.appendImport(page.items[0].id,0,[bytes]);await m.intakes.enqueue(batch.id,jobs.queue);const completed=await perform(jobs.queue,batch.id);assert.equal(completed.state,'completed');const source=(await m.referencePage(completed.result)).items[0],doc=await m.read(source);assert.equal(doc.content.sourcePath,descriptor.sourcePath);assert.equal(doc.content.acquisition.revision,session.acquisition.revision);assert.deepEqual((await m.intakes.list(recordId)).items,[]);
 const command={recordId,title:'Retained measurements',artifact,columns:[defaultColumn({label:'Group'}),{...defaultColumn({label:'Reading'}),representation:'decimal'}]},queued=await enqueueDataset(m,jobs.queue,command),dataset=(await perform(jobs.queue,queued.id)).result;assert.equal((await m.datasetPage(dataset)).rows.length,2);assert.ok((await datasetJobs(m,jobs.queue,recordId)).items.some(job=>job.id===queued.id));
 const plotted=await enqueuePlot(m,jobs.queue,{recordId,title:'Measurement figure',dataset,mapping:{x:0,xKind:'category',values:[{column:1,error:null}],group:null,operation:'raw',kind:'bar',order:'source',mode:'replace',decimal:'.'}});assert.equal((await perform(jobs.queue,plotted.id)).state,'completed');
 const draft=await m.drafts.start({draftId:randomUUID(),recordId,kind:'analysis',title:'Interpretation',totals:{inputs:2,outputs:0},tool:'Reviewed procedure',version:'1',parameters:''});await m.drafts.append({id:draft.id,offset:0,items:[session.acquisition,dataset]});assert.equal((await m.drafts.page({id:draft.id})).items[0].title,f.record.title);const analysis=await m.drafts.finish(draft.id);assert.equal((await m.referencePage(analysis)).items.length,2);assert.deepEqual((await m.drafts.list(recordId)).items,[]);
 const titleTarget={workspaceId:f.book.id,recordId,field:'title'},values=new RecordValues(f.workspace),title=await values.read(titleTarget);await values.save({...titleTarget,expectedRevision:title.revision,value:{value:'Amended acquisition interpretation'}});const summary=await m.recordSummary(recordId);assert.equal(summary.title,'Amended acquisition interpretation');assert.notEqual(summary.revision,session.acquisition.revision);
 const overview=await m.overview(recordId);assert.equal(overview.items.find(value=>value.id===f.analysis.id).figureState,'matches');assert.ok((await m.reviewDependencies(recordId,{refs:[analysis]})).items[0].changed.some(value=>value.id===recordId));const state=await analysisDependencyState(m,[{recordId,analysis}]);assert.ok(state.items[0].sample.some(value=>value.id===recordId));
 const figure=await f.values.read(f.target(f.record.figures[0].id));figure.value.value.title='Amended figure';await f.save(figure,figure.value.value);assert.equal((await m.overview(recordId)).items.find(value=>value.id===f.analysis.id).figureState,'edited');await m.verify();
});

test('upload acquisition pins and admission roll back together and preserve their start revision',async t=>{
 const f=await figureValueFixture();t.after(f.close);const m=f.materials,recordId=f.record.id,summary=await m.recordSummary(recordId),file='.observanda/materials/records/'+recordId+'/'+summary.revision+'.json',insert=m.index.addImport.bind(m.index);forbid(t);
 t.mock.method(m.index,'addImport',async session=>{await insert(session);throw Error('Interrupted upload admission');});await assert.rejects(m.startImport({recordId,name:'empty.img',size:0}),/Interrupted upload/);m.index.addImport.mock.restore();assert.equal(await f.workspace.readMetadata(file,1024),null);assert.deepEqual(await m.imports(recordId),[]);
 const session=await m.startImport({recordId,name:'empty.img',size:0}),target={workspaceId:f.book.id,recordId,field:'title'},values=new RecordValues(f.workspace),base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value:'New interpretation'}});const artifact=await m.finishImport(session.id),value=await m.read(artifact);assert.equal(value.content.acquisition.revision,summary.revision);assert.equal((await m.describeReferences({items:[value.content.acquisition]})).items[0].title,summary.title);
 await assert.rejects(m.startImport({recordId:randomUUID(),name:'unknown.img',size:0}),{code:'MATERIAL_INVALID'});await assert.rejects(m.drafts.start({recordId:randomUUID(),kind:'collection',title:'Missing owner',totals:{inputs:1,outputs:0}}),{code:'MATERIAL_INVALID'});await m.verify();
});
