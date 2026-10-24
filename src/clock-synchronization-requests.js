import {AppError} from './errors.js';
import {prepareClockSynchronization,verifyClockSynchronization,validateClockSynchronizationEdit} from './measurement-clock-synchronization.js';
import {CLOCK_SYNCHRONIZATION_TOOL,validClockSynchronization,validClockSynchronizationSegment,validClockSynchronizationAnchor} from './web/measurement-clock-synchronization-model.js';
import {schemaReferences} from './web/measurement-model.js';
import {materialReferenceKey} from './web/material-reference.js';
import {revisionText} from './web/revision-model.js';
import {validGraphAddress} from './web/dataset-calculation-graph-model.js';
import {changeGraphSequence,moveGraphSequence,removeGraphSequence} from './calculation-graph-sequence.js';
import {retainScalarDefinitions,readScalarDefinition} from './measurement-scalar-storage.js';
import {withScratch} from './scratch-work.js';
const fail=()=>{throw new AppError('MEASUREMENT_CLOCK_SYNCHRONIZATION');};
const index=value=>Number.isSafeInteger(value)&&value>=0;
const fields=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
export function clockSynchronizationReferences(content){return [...new Map([content.source.ref,...(content.version===2?[content.reference.ref]:content.anchors.flatMap(anchor=>[anchor.source.ref,anchor.reference.ref])),...schemaReferences(content.target)].map(ref=>[materialReferenceKey(ref),ref])).values()];}
// Editable v2 revisions reuse the authenticated sequence owner. Draft ordering
// may be amended explicitly; graph compilation alone admits complete models.
export class SegmentedClockSynchronizations{
 constructor(materials){this.materials=materials;this.sequences=materials.sequences;}
 async empty(kind){return this.sequences.builder(kind,fn=>fn()).finish();}
 async read(ref){const doc=await this.materials.read(ref);await this.materials.assertOwner(doc.recordId);if(doc.kind!=='analysis'||doc.content.tool!==CLOCK_SYNCHRONIZATION_TOOL||doc.content.version!==2||!validClockSynchronization(doc.content))fail();this.sequences.validate(doc.content.segmentsIndex);return doc;}
 async segment(content,address){if(!validGraphAddress(address)||address.position>=content.segmentsIndex.count)fail();const value=await this.sequences.item(content.segmentsIndex,address.position);if(value.id!==address.id||!validClockSynchronizationSegment(value))fail();this.sequences.validate(value.anchorsIndex);return value;}
 async columns(content){const result={};for(const side of ['source','reference']){const selected=content[side],doc=await this.materials.read(selected.ref);await this.materials.assertOwner(doc.recordId);if(doc.kind!=='dataset')fail();result[side+'Column']=await this.materials.datasetColumn(doc,selected.column);}return result;}
 async prepared(synchronization,segmentsIndex,{base,signal}={}){
  if(!fields(synchronization,['version','method','source','reference','target','rationale','resourcePolicy'])||synchronization.version!==2)fail();
  const content=await prepareClockSynchronization(this.materials,{...synchronization,segmentsIndex},{complete:false,headerOnly:true,base,write:fn=>fn(),signal});
  const inputs=this.sequences.builder('references',fn=>fn());for(const ref of clockSynchronizationReferences(content)){signal?.throwIfAborted();await this.materials.checkReference(ref);await inputs.append(ref);}content.inputsIndex=await inputs.finish();return content;
 }
 header(content){return Object.fromEntries(['version','method','source','reference','target','rationale','resourcePolicy'].map(key=>[key,content[key]]));}
 async create({recordId,title,synchronization},{signal}={}){return this.materials.workspace.withCatalogueConnections(()=>this.materials.workspace.withLock(async()=>{await this.materials.assertOwner(recordId,{write:true});const content=await this.prepared(synchronization,await this.empty('clock-sync-segments'),{signal});return this.materials.commit({kind:'analysis',recordId,title,content});}));}
 async change(command,{signal}={}){return this.materials.workspace.withCatalogueConnections(()=>this.materials.workspace.withLock(async()=>{
  const {ref,collection,offset,item,remove=false,move}=command,doc=await this.read(ref);await this.materials.assertOwner(doc.recordId,{write:true});if((await this.materials.current(doc.id))?.revision!==ref.revision)throw new AppError('MATERIAL_CHANGED');let segmentsIndex=doc.content.segmentsIndex,synchronization=this.header(doc.content),editedSegment,editedAnchor;
  if(collection==='settings'){synchronization=command.synchronization;if(segmentsIndex.count&&['source','reference'].some(side=>revisionText(synchronization?.[side])!==revisionText(doc.content[side])))fail();}
  else{
   if(!['segments','anchors'].includes(collection)||!index(offset)||move!==undefined&&(item!==undefined||remove)||remove&&item!==undefined)fail();const segment=collection==='anchors'?await this.segment(doc.content,command.segment):null,descriptor=segment?.anchorsIndex??segmentsIndex;if(offset>descriptor.count)fail();let next;
   if(move!==undefined)next=await moveGraphSequence(this.sequences,descriptor,offset,move,{signal});
   else if(remove)next=await removeGraphSequence(this.sequences,descriptor,offset,{signal});
   else{
    const prior=offset<descriptor.count?await this.sequences.item(descriptor,offset):undefined;let saved=item;
    if(collection==='segments'){if(!fields(item,['version','kind','id','name','range','validity','rationale','resourcePolicy'])||prior&&prior.id!==item.id)fail();if(!prior)for await(const other of this.sequences.items(segmentsIndex)){signal?.throwIfAborted();if(other.id===item.id)fail();}saved={...item,anchorsIndex:prior?.anchorsIndex??await this.empty('clock-sync-anchors')};if(!validClockSynchronizationSegment(saved))fail();saved=await retainScalarDefinitions(this.materials,saved,fn=>fn(),{base:prior,signal});editedSegment=saved;}
    else{if(!validClockSynchronizationAnchor(saved,doc.content))fail();editedSegment=segment;editedAnchor=saved;}
    next=await changeGraphSequence(this.sequences,descriptor,offset,saved);
   }
   if(segment)segmentsIndex=await changeGraphSequence(this.sequences,segmentsIndex,command.segment.position,{...segment,anchorsIndex:next});else segmentsIndex=next;
  }
  const content=await this.prepared(synchronization,segmentsIndex,{base:doc.content,signal});if(editedSegment)await validateClockSynchronizationEdit(this.materials,content,{segment:editedSegment,anchor:editedAnchor,signal});return this.materials.commit({kind:'analysis',id:doc.id,recordId:doc.recordId,title:command.title??doc.title,expectedRevision:ref.revision,content});
 }));}
 async page({ref,collection='segments',segment,offset=0,limit=16},{signal}={}){return this.materials.workspace.withCatalogueConnections(async()=>{
  if(!['segments','anchors'].includes(collection)||!index(offset)||!Number.isSafeInteger(limit)||limit<1||limit>16)fail();const doc=await this.read(ref),selected=collection==='anchors'?await this.segment(doc.content,segment):null,page=await this.sequences.page(selected?.anchorsIndex??doc.content.segmentsIndex,{offset,limit});
  for(const item of page.items){signal?.throwIfAborted();if(collection==='segments'){if(!validClockSynchronizationSegment(item))fail();}else{if(!validClockSynchronizationAnchor(item,doc.content))fail();for(const locator of [item.source,item.reference]){const source=await this.materials.read(locator.ref);await this.materials.assertOwner(source.recordId);await this.materials.measurements.cell(locator);}}}
  return {...page,ref,title:doc.title,recordId:doc.recordId,isCurrent:(await this.materials.current(doc.id))?.revision===ref.revision,content:doc.content,collection,...(selected?{segment:selected,segmentAddress:segment}:{}),...await this.columns(doc.content)};
 });}
 async scalar({ref,segment,field,offset=0,limit=4096},{signal}={}){return this.materials.workspace.withCatalogueConnections(async()=>{const doc=await this.read(ref),selected=await this.segment(doc.content,segment);if(!['validity.lower.spelling','validity.upper.spelling'].includes(field)||!index(offset)||!Number.isSafeInteger(limit)||limit<1||limit>4096)fail();await this.columns(doc.content);return readScalarDefinition(this.materials,selected,field,{offset,limit,signal});});}
}
export async function clockSynchronizationRequest(materials,operation,data,{signal}={}){
 const segmented=new SegmentedClockSynchronizations(materials);
 if(operation==='clock-synchronization-create'){if(!fields(data,['recordId','title','synchronization']))fail();return {ref:await segmented.create(data,{signal})};}
 if(operation==='clock-synchronization-change'){if(!fields(data,['ref','collection','segment','offset','item','remove','move','synchronization','title']))fail();return {ref:await segmented.change(data,{signal})};}
 if(operation==='clock-synchronization-page'){if(!fields(data,['ref','collection','segment','offset','limit']))fail();return segmented.page(data,{signal});}
 if(operation==='clock-synchronization-scalar'){if(!fields(data,['ref','segment','field','offset','limit']))fail();return segmented.scalar(data,{signal});}
 const read=operation==='clock-synchronization-read',allowed=read?['ref']:['recordId','title','id','expectedRevision','synchronization'];if(!fields(data,allowed))fail();signal?.throwIfAborted();
 if(read)return materials.workspace.withCatalogueConnections(async()=>{const doc=await materials.read(data.ref);if(doc.kind!=='analysis'||doc.content.tool!==CLOCK_SYNCHRONIZATION_TOOL)fail();await materials.assertOwner(doc.recordId);return {ref:data.ref,title:doc.title,recordId:doc.recordId,content:doc.content};});
 if(operation!=='clock-synchronization-save'||data.synchronization?.version!==1)fail();return materials.workspace.withCatalogueConnections(()=>materials.workspace.withLock(async()=>{await materials.assertOwner(data.recordId,{write:true});const previous=data.id&&data.expectedRevision?await materials.read({kind:'analysis',id:data.id,revision:data.expectedRevision}):null;if(previous&&(previous.recordId!==data.recordId||previous.content.tool!==CLOCK_SYNCHRONIZATION_TOOL||previous.content.version!==1))fail();const content=await prepareClockSynchronization(materials,data.synchronization,{write:fn=>fn(),signal,base:previous?.content});content.inputs=clockSynchronizationReferences(content);for(const ref of content.inputs){signal?.throwIfAborted();await materials.checkReference(ref);}signal?.throwIfAborted();return {ref:await materials.commit({kind:'analysis',recordId:data.recordId,title:data.title,id:data.id,expectedRevision:data.expectedRevision,content})};}));
}
export async function verifyClockSynchronizationInputs(materials,content,options={}){
 await verifyClockSynchronization(materials,content,{...options,complete:content.version!==2});const expected=new Set(clockSynchronizationReferences(content).map(materialReferenceKey)),actual=new Set();for await(const ref of materials.references(content))actual.add(materialReferenceKey(ref));if(revisionText([...actual].sort())!==revisionText([...expected].sort()))fail();
 if(content.version===2)await withScratch(async work=>{for await(const segment of materials.sequences.items(content.segmentsIndex)){options.signal?.throwIfAborted();if(!await work.add(segment.id))fail();}},options);
}
