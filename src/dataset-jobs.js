// Dataset and figure preparation share the workspace worker and paged job feed.
import {randomUUID} from 'node:crypto';
import {createFigure} from './web/figure-model.js';
import {MetadataFeed} from './metadata-feed.js';
import {jobSummary} from './jobs.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
const source=recordId=>{if(!researchId(recordId))throw new AppError('INVALID');return '.observanda/dataset-jobs/'+recordId;};
export const enqueueDataset=(materials,queue,command,id)=>enqueueMaterial(materials,queue,command,id,'dataset.prepare');
export const enqueuePlot=(materials,queue,command,id)=>enqueueMaterial(materials,queue,command,id,'figure.calculate');
export const enqueueComparison=(materials,queue,command,id)=>enqueueMaterial(materials,queue,command,id,'analysis.compare');
async function enqueueMaterial(materials,queue,command,id=randomUUID(),type){
 if(!researchId(id))throw new AppError('INVALID');
 const input={...command,id:command.id??id,expectedRevision:command.expectedRevision??null};
 if(type==='figure.calculate')input.base={...(command.base??createFigure()),id:command.base?.id??input.id,series:[]};
 return queue.transaction(async()=>{
  if(!await queue.read(id))await (type==='dataset.prepare'?materials.validateDataset(input):type==='analysis.compare'?materials.comparisons.validate(input):materials.validatePlot(input));
  const job=await queue.enqueueLocked({id,type,scope:input.recordId,input:{command:input}});
  const feed=new MetadataFeed(materials.workspace,source(input.recordId));await feed.ensureLocked();
  await materials.workspace.writeMetadata(feed.source+'/'+id+'.json',JSON.stringify({id,createdAt:job.createdAt,title:input.title}));
  await feed.putLocked(job);return jobSummary(job);
 });
}
export async function datasetJobs(materials,queue,recordId,options={}){
 await materials.assertOwner(recordId);
 const feed=new MetadataFeed(materials.workspace,source(recordId)),page=await feed.page(options),items=[];
 for(const item of page.items){
  const job=await queue.read(item.id);
  if(!job||!['dataset.prepare','figure.calculate','analysis.compare'].includes(job.type)||job.scope!==recordId)throw new AppError('JOB_DAMAGED');
  items.push({...jobSummary(job),title:job.input.command.title});
 }
 return {items,next:page.next};
}
