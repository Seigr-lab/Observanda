// Immutable frame revisions and bounded author-directed axis edits share the
// material sequence owner. Saving a draft never certifies an affine transform.
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {changeGraphSequence,moveGraphSequence,removeGraphSequence} from './calculation-graph-sequence.js';
import {retainScalarDefinitions} from './measurement-scalar-storage.js';
import {readDatasetCell} from './dataset-cell-storage.js';
import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {materialReference,materialReferenceKey} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {COORDINATE_FRAME_TOOL,COORDINATE_FRAME_TRANSFORM_TOOL,CoordinateFrameError,validCoordinateFrame,validCoordinateFrameAxis,validCoordinateFrameTransform} from './web/coordinate-frame-model.js';
import {validateCoordinateFrameDefinition,verifyCoordinateFrameTransform} from './coordinate-frame-transform.js';
import {assertCoordinateFrameFormat} from './coordinate-frame-format.js';
const fail=(code='COORDINATE_FRAME_INVALID')=>{throw code.startsWith('COORDINATE_FRAME_')?new CoordinateFrameError(code):new AppError(code);};
const fields=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>names.includes(key));
const headerKeys=['version','namespace','dimension','unit','unitDefinition','rationale','resourcePolicy'];
const transformKeys=['version','method','sourceFrame','targetFrame','matrix','offset','rationale','resourcePolicy'];
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const checkpoint=async options=>{options.signal?.throwIfAborted();await options.check?.();options.signal?.throwIfAborted();};
export function coordinateFrameReferences(content){
 if(content?.tool===COORDINATE_FRAME_TOOL)return [];
 if(content?.tool!==COORDINATE_FRAME_TRANSFORM_TOOL||!validCoordinateFrameTransform(content))fail();
 return [...new Map([content.sourceFrame,content.targetFrame,content.matrix.ref,content.offset.ref].map(ref=>[materialReferenceKey(ref),materialReference(ref)])).values()];
}
export class CoordinateFrames{
 constructor(materials,{withWork=withScratch}={}){this.materials=materials;this.sequences=materials.sequences;this.withWork=withWork;}
 async scope(operation){return this.materials.workspace.withCatalogueConnections(operation);}
 shape(doc,{transform=false}={}){if(doc?.kind!=='analysis'||doc.content?.tool!==(transform?COORDINATE_FRAME_TRANSFORM_TOOL:COORDINATE_FRAME_TOOL)||!(transform?validCoordinateFrameTransform(doc.content):validCoordinateFrame(doc.content,{complete:false})))fail();if(!transform)this.sequences.validate(doc.content.axesIndex);this.sequences.validate(doc.content.inputsIndex);if(doc.content.inputsIndex.kind!=='references')fail('MATERIAL_MISSING');return doc;}
 async read(ref,{transform=false,...options}={}){await checkpoint(options);const doc=this.shape(await this.materials.read(ref),{transform});await this.materials.assertOwner(doc.recordId);await assertCoordinateFrameFormat(this.materials.workspace);await checkpoint(options);return doc;}
 async inputs(content,options){const builder=this.sequences.builder('references',fn=>fn());for(const ref of coordinateFrameReferences(content)){await checkpoint(options);await this.materials.checkReference(ref);await builder.append(ref);}return builder.finish();}
 async prepare(frame,axesIndex,{base,...options}={}){
  if(!fields(frame,headerKeys))fail();const content={tool:COORDINATE_FRAME_TOOL,...structuredClone(frame),axesIndex},budget=new DatasetResourceBudget(frame.resourcePolicy);
  await validateCoordinateFrameDefinition(this.materials,content,{...options,budget});content.unitDefinition=await retainScalarDefinitions(this.materials,frame.unitDefinition,fn=>fn(),{base:base?.unitDefinition,...options,budget});content.inputsIndex=await this.inputs(content,options);return content;
 }
 async create({recordId,title,frame},options={}){return this.scope(()=>this.materials.workspace.withLock(async()=>{
  await checkpoint(options);await this.materials.assertOwner(recordId,{write:true});const axesIndex=await this.sequences.builder('coordinate-frame-axes',fn=>fn()).finish(),content=await this.prepare(frame,axesIndex,options);await checkpoint(options);return this.materials.commit({kind:'analysis',recordId,title,content});
 }));}
 async change(command,options={}){return this.scope(()=>this.materials.workspace.withLock(async()=>{
  const {ref,collection,offset,item,remove=false,move}=command,doc=await this.read(ref,options);await this.materials.assertOwner(doc.recordId,{write:true});if((await this.materials.current(doc.id))?.revision!==ref.revision)fail('MATERIAL_CHANGED');let axesIndex=doc.content.axesIndex,frame=Object.fromEntries(headerKeys.map(key=>[key,doc.content[key]]));
  if(collection==='settings'){if(item!==undefined||offset!==undefined||remove||move!==undefined)fail();frame=command.frame;}
  else if(collection==='axes'){
   if(command.frame!==undefined||!natural(offset)||offset>axesIndex.count||move!==undefined&&(item!==undefined||remove)||remove&&item!==undefined)fail();
   if(move!==undefined)axesIndex=await moveGraphSequence(this.sequences,axesIndex,offset,move,options);
   else if(remove)axesIndex=await removeGraphSequence(this.sequences,axesIndex,offset,options);
   else{if(!validCoordinateFrameAxis(item)||offset===axesIndex.count&&axesIndex.count>=frame.dimension)fail();if(offset<axesIndex.count&&(await this.sequences.item(axesIndex,offset)).id!==item.id)fail();axesIndex=await changeGraphSequence(this.sequences,axesIndex,offset,structuredClone(item));}
  }else fail();
  const content=await this.prepare(frame,axesIndex,{...options,base:doc.content});await checkpoint(options);return this.materials.commit({kind:'analysis',id:doc.id,recordId:doc.recordId,title:command.title??doc.title,expectedRevision:ref.revision,content});
 }));}
 async page({ref,offset=0,limit=16},options={}){return this.scope(async()=>{
  if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>16)fail();const doc=await this.read(ref,options);await validateCoordinateFrameDefinition(this.materials,doc.content,options);const page=await this.sequences.page(doc.content.axesIndex,{offset,limit});for(const item of page.items){await checkpoint(options);if(!validCoordinateFrameAxis(item))fail('MATERIAL_MISSING');}
  return {...page,ref,title:doc.title,recordId:doc.recordId,isCurrent:(await this.materials.current(doc.id))?.revision===ref.revision,frame:doc.content};
 });}
 async scalar({ref,field,offset=0,limit=4096},options={}){return this.scope(async()=>{
  if(!['unitDefinition.scale.spelling','unitDefinition.offset.spelling'].includes(field)||!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>4096)fail();const doc=await this.read(ref,options);await validateCoordinateFrameDefinition(this.materials,doc.content,options);return readDatasetCell(this.materials,doc.content.unitDefinition[field.split('.')[1]].spelling,{offset,limit,signal:options.signal});
 });}
 async transformSave({recordId,title,id,expectedRevision,transform},options={}){return this.scope(()=>this.materials.workspace.withLock(async()=>{
  if(!fields(transform,transformKeys)||!validCoordinateFrameTransform(transform)||id!==undefined&&!researchId(id)||expectedRevision!==undefined&&expectedRevision!==null&&!revisionId(expectedRevision)||expectedRevision&&!id)fail();await checkpoint(options);await this.materials.assertOwner(recordId,{write:true});
  if(id){const head=await this.materials.current(id);if((head?.revision??null)!==(expectedRevision??null))fail('MATERIAL_CHANGED');if(head){const prior=await this.read({kind:'analysis',id,revision:head.revision},{...options,transform:true});if(prior.recordId!==recordId)fail();}}
  const content={tool:COORDINATE_FRAME_TRANSFORM_TOOL,...structuredClone(transform)};await this.withWork(work=>verifyCoordinateFrameTransform(this.materials,content,{...options,work}),options);content.inputsIndex=await this.inputs(content,options);await checkpoint(options);return this.materials.commit({kind:'analysis',recordId,title,id,expectedRevision,content});
 }));}
 async transformRead({ref},options={}){return this.scope(async()=>{
  const doc=await this.read(ref,{...options,transform:true}),frames=[];for(const reference of [doc.content.sourceFrame,doc.content.targetFrame]){const frame=await this.read(reference,options);await validateCoordinateFrameDefinition(this.materials,frame.content,{...options,complete:true});frames.push({ref:reference,frame:frame.content});}
  for(const reference of [doc.content.matrix.ref,doc.content.offset.ref]){await checkpoint(options);await this.materials.checkReference(reference);}
  return {ref,title:doc.title,recordId:doc.recordId,isCurrent:(await this.materials.current(doc.id))?.revision===ref.revision,transform:doc.content,sourceFrame:frames[0],targetFrame:frames[1]};
 });}
 async verify(doc,options={}){
  const transform=doc.content?.tool===COORDINATE_FRAME_TRANSFORM_TOOL;this.shape(doc,{transform});await assertCoordinateFrameFormat(this.materials.workspace);await this.materials.assertOwner(doc.recordId);
  await this.withWork(work=>transform?verifyCoordinateFrameTransform(this.materials,doc.content,{...options,work}):validateCoordinateFrameDefinition(this.materials,doc.content,{...options,scanAxes:true,work}),options);
  const expected=new Set(coordinateFrameReferences(doc.content).map(materialReferenceKey)),found=new Set();if(doc.content.inputsIndex.count!==expected.size)fail('MATERIAL_MISSING');
  for await(const ref of this.sequences.items(doc.content.inputsIndex)){await checkpoint(options);const key=materialReferenceKey(ref);if(!expected.has(key)||found.has(key))fail('MATERIAL_MISSING');await this.materials.checkReference(ref);found.add(key);}if(found.size!==expected.size)fail('MATERIAL_MISSING');
 }
}
export function verifyCoordinateFrameInputs(materials,doc,options={}){return new CoordinateFrames(materials).verify(doc,options);}
export async function coordinateFrameRequest(materials,operation,data,options={}){
 const service=new CoordinateFrames(materials),commands={
  'coordinate-frame-create':['create',['recordId','title','frame'],true],
  'coordinate-frame-change':['change',['ref','collection','offset','item','remove','move','frame','title'],true],
  'coordinate-frame-page':['page',['ref','offset','limit']],
  'coordinate-frame-scalar':['scalar',['ref','field','offset','limit']],
  'coordinate-frame-transform-save':['transformSave',['recordId','title','id','expectedRevision','transform'],true],
  'coordinate-frame-transform-read':['transformRead',['ref']]
 },command=commands[operation];if(!command||!fields(data,command[1]))fail();const result=await service[command[0]](data,options);return command[2]?{ref:result}:result;
}
