// Evidence commands are shared by workspace and selected-project HTTP adapters.
// The caller supplies the authorized storage owner and its own durable job service.
import {ResearchMaterials} from './research-materials.js';
import {EvidenceCorrections} from './evidence-corrections.js';
import {RetainedRecordDocuments} from './retained-record-documents.js';
import {DatasetCalculations} from './dataset-calculations.js';
import {retainedTable} from './retained-tables.js';
import {enqueueDataset,enqueuePlot,enqueueComparison,datasetJobs} from './dataset-jobs.js';
import {analysisDependencyState} from './analysis-dependencies.js';
import {associateOriginal} from './evidence-associations.js';
import {resolveFigureSources} from './figure-provenance.js';
import {jobSummary} from './jobs.js';
import {MAX_BYTES} from './model.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const reads=new Set(['overview','list','references','correction-preview','correction-status','correction-history','association-read','association-list','figure-sources','selection-page','intakes','intake-selection-page','intake-page','intake-session','drafts','draft-read','draft-references','current','schema','measurement-inspect','measurement-seed','current-record','record','read','analysis-status','job','retained-table','calculation-schema','dataset-preview','dataset-jobs','rows','comparison-page','verify','download']);
const writes=new Set(['associate-original','correction-apply','association-start','association-step','association-cancel','selection-change','intake-start','intake-selection-append','intake-append','intake-finish','draft-start','draft-append','draft-finish','draft-cancel','measurement-save','pin','start','finish','cancel-job','retry-job','dataset','collection','analysis','comparison','reuse','plot']);
const accepted=new Set(['intake-finish','finish','dataset','comparison','plot']);
export function materialRequest(route){
 const prefix='/api/research/materials/';if(!route.startsWith(prefix))return null;const operation=route.slice(prefix.length);
 const original=/^original\/([a-f0-9-]{36})\/([a-f0-9]{64})$/.exec(operation);
 if(original&&researchId(original[1]))return {material:'download',method:'GET',write:false,download:true,ref:{kind:'artifact',id:original[1],revision:original[2]}};
 const chunk=/^chunk\/([a-f0-9-]{36})\/(\d+)$/.exec(operation);
 if(chunk&&researchId(chunk[1])&&Number.isSafeInteger(Number(chunk[2])))return {material:'chunk',method:'POST',write:true,input:'stream',id:chunk[1],index:Number(chunk[2])};
 if(!reads.has(operation)&&!writes.has(operation))return null;
 return {material:operation,method:'POST',write:writes.has(operation),limit:MAX_BYTES,status:accepted.has(operation)?202:200,download:operation==='download'};
}
export async function executeMaterialRequest(storage,request,data,{signal,jobs,download,stream}={}){
 const materials=new ResearchMaterials(storage),operation=request.material;
 const jobService=async()=>{const result=await jobs?.();if(!result)throw new AppError('ACCESS_LOCKED');return result;};
 switch(operation){
 case 'chunk':return materials.uploads.summary(await materials.appendImport(request.id,request.index,stream,{signal}));
 case 'download':{if(typeof download!=='function')throw new AppError('INVALID');return download(await materials.artifact(request.ref??data.ref));}
 case 'overview':{const result=await materials.overview(data.recordId,{cursor:data.cursor,importCursor:data.importCursor,limit:data.limit});if(result.imports.length){const {queue}=await jobService();for(const session of result.imports)session.job=jobSummary(await queue.read(session.id));}return result;}
 case 'list':{const page=await materials.list({...data,pending:false,signal});return {...page,items:page.items.map(({kind,id,revision,recordId,title,createdAt})=>({kind,id,revision,recordId,title,createdAt}))};}
 case 'references':return materials.referencePage(data.ref,data);
 case 'associate-original':return {ref:await associateOriginal(materials,data)};
 case 'correction-preview':return new EvidenceCorrections(materials).preview(data);
 case 'correction-apply':return new EvidenceCorrections(materials).apply(data);
 case 'correction-status':return new EvidenceCorrections(materials).status(data.ref);
 case 'correction-history':return new EvidenceCorrections(materials).history(data);
 case 'association-start':return materials.associations.start(data);
 case 'association-read':return materials.associations.summary(await materials.associations.authorized(data.id));
 case 'association-step':return materials.associations.step(data.id);
 case 'association-cancel':return materials.associations.cancel(data.id);
 case 'association-list':return materials.associations.list(data);
 case 'figure-sources':return resolveFigureSources(materials,data);
 case 'selection-change':return materials.choices.change(data);
 case 'selection-page':return materials.choices.page(data);
 case 'intakes':return materials.intakes.list(data.recordId,{cursor:data.cursor,limit:data.limit});
 case 'intake-start':return materials.intakes.start(data);
 case 'intake-selection-append':return materials.intakes.choices.append(data);
 case 'intake-selection-page':return materials.intakes.choices.page(data);
 case 'intake-append':return materials.intakes.append(data);
 case 'intake-page':return materials.intakes.page(data);
 case 'intake-session':{const session=await materials.importState(data.id);if(!session.batchId)throw new AppError('INVALID');await materials.intakes.authorized(session.batchId);return materials.uploads.summary(session);}
 case 'intake-finish':{const {queue,worker}=await jobService(),job=await materials.intakes.enqueue(data.id,queue);worker.wake();return {job:jobSummary(job)};}
 case 'drafts':return materials.drafts.list(data.recordId,{cursor:data.cursor,limit:data.limit});
 case 'draft-start':return materials.drafts.start(data);
 case 'draft-read':return materials.drafts.summary(await materials.drafts.authorized(data.id),{details:true});
 case 'draft-append':return materials.drafts.append(data);
 case 'draft-references':return materials.drafts.page(data);
 case 'draft-finish':return {ref:await materials.drafts.finish(data.id)};
 case 'draft-cancel':return materials.drafts.cancel(data.id);
 case 'current':return {item:await materials.current(data.id)};
 case 'schema':return materials.schemaPage(data.ref,{offset:data.offset??0,limit:data.limit??16});
 case 'measurement-save':return {ref:await materials.measurements.save(data,{signal})};
 case 'measurement-seed':return materials.measurements.seed(data.source);
 case 'measurement-inspect':return materials.measurements.inspect(data.source,{offset:data.offset??0,signal});
 case 'current-record':try{const current=await materials.owner(data.id);return {record:current.entries.find(e=>e.id===data.id)};}catch(error){if(error.code!=='MATERIAL_INVALID')throw error;return {record:null};}
 case 'pin':return materials.pinRecord(data.id,data.expectedRevision);
 case 'record':return new RetainedRecordDocuments(storage).read(data,{signal});
 case 'read':return materials.read(data.ref);
 case 'analysis-status':{const doc=await materials.read(data.ref);if(doc.kind!=='analysis')throw new AppError('ANALYSIS_INVALID');return analysisDependencyState(materials,[{recordId:doc.recordId,analysis:data.ref}]);}
 case 'start':return materials.uploads.summary(await materials.startImport(data));
 case 'finish':{if(!storage.vault.key)throw new AppError('ACCESS_LOCKED');const session=await materials.importState(data.id);if(session.batchId)throw new AppError('MATERIAL_CHANGED');await materials.assertOwner(session.recordId);if(materials.uploads.bytes(session)!==session.size)throw new AppError('MATERIAL_INCOMPLETE');const {queue,worker}=await jobService(),job=await queue.enqueue({id:session.id,type:'evidence.finalize',scope:session.recordId,input:{importId:session.id,size:session.size}});worker.wake();return {job:jobSummary(job)};}
 case 'job':case 'cancel-job':case 'retry-job':{const {queue,worker}=await jobService(),job=await queue.read(data.id);if(!job)throw new AppError('NOT_FOUND');await queue.authorize(job);if(operation==='job')return {job:jobSummary(job)};const result=await queue.control(data.id,operation==='cancel-job'?'cancel':'retry');if(operation==='cancel-job')worker.cancel(data.id);else worker.wake();return {job:jobSummary(result)};}
 case 'retained-table':return retainedTable(materials,data);
 case 'calculation-schema':return {columns:await new DatasetCalculations(materials).schema(data.ref,data.view)};
 case 'dataset-preview':return materials.previewDataset(data,{signal});
 case 'dataset':case 'comparison':case 'plot':{const {queue,worker}=await jobService(),{jobId,...command}=data,enqueue=operation==='dataset'?enqueueDataset:operation==='comparison'?enqueueComparison:enqueuePlot,job=await enqueue(materials,queue,command,jobId);worker.wake();return {job};}
 case 'dataset-jobs':{const {queue}=await jobService();return datasetJobs(materials,queue,data.recordId,{cursor:data.cursor??null});}
 case 'rows':return materials.datasetPage(data.ref,data.page??0,{columnOffset:data.columnOffset??0});
 case 'collection':return materials.collection(data);
 case 'analysis':return materials.analysis(data);
 case 'comparison-page':return materials.comparisons.page(data,{signal});
 case 'reuse':return materials.reuseFigure(data);
 case 'verify':return materials.verify();
 default:throw new AppError('INVALID');
 }
}
