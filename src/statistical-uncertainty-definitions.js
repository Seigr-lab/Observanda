// Paged editable model revisions share the material sequence owner. A result
// pins one complete revision; individual edits never publish a scientific result.
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {changeGraphSequence} from './calculation-graph-sequence.js';
import {retainScalarDefinitions,resolveScalarDefinitions,resolveScalarOperand,readScalarDefinition} from './measurement-scalar-storage.js';
import {validLocator,validMeasurement,isScalarRepresentation} from './web/measurement-model.js';
import {defaultColumn} from './web/dataset-schema.js';
import {materialReference,materialReferenceKey} from './web/material-reference.js';
import {revisionText} from './web/revision-model.js';
import {validStatisticalUncertaintyDefinition,validStatisticalUncertaintyInput,validStatisticalUncertaintyCovariance,statisticalUncertaintyCovarianceCount,statisticalUncertaintyCovariancePosition} from './web/measurement-statistical-uncertainty-model.js';
import {assertStatisticalUncertaintyFormat} from './statistical-uncertainty-format.js';
export const UNCERTAINTY_DEFINITION_TOOL='Observanda uncertainty definition';
export const UNCERTAINTY_RESULT_TOOL='Observanda statistical uncertainty';
const slots={inputs:'uncertaintyInputsIndex',covariance:'uncertaintyCovarianceIndex'},kinds={inputs:'uncertainty-inputs',covariance:'uncertainty-covariance'};
export const uncertaintyFailure=(code='STATISTICAL_UNCERTAINTY_INVALID')=>{throw new AppError(code);};
const estimateKey=source=>materialReferenceKey(source.ref)+':'+[source.selector.page,source.selector.row,source.selector.column].join(':');
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
export async function uncertaintySource(materials,source,{signal,policy,budget,resolve=false,check=async()=>{}}={}){
 signal?.throwIfAborted();await check();if(!validLocator(source))uncertaintyFailure();const doc=await materials.read(source.ref);await materials.assertOwner(doc.recordId);let column,cell;
 if(doc.kind==='dataset'&&source.selector.kind==='cell'){
  const selected=await materials.measurements.cell(source);if(selected.row.excluded||selected.value.presence!=='value')uncertaintyFailure('STATISTICAL_UNCERTAINTY_INPUT');column=selected.column;cell={kind:'string',value:selected.cellReference??selected.value.spelling};
 }else if(doc.kind==='analysis'&&source.selector.kind==='whole'&&validMeasurement(doc.content.measurement)){
  const value=doc.content.measurement;if(value.value.presence!=='value')uncertaintyFailure('STATISTICAL_UNCERTAINTY_INPUT');await materials.measurements.validate(value,{signal,semantic:resolve});column={...defaultColumn({label:doc.title}),representation:value.value.representation,radix:value.value.radix,unit:value.value.unit,quantity:value.quantity,time:value.time,...(value.resourcePolicy?{resourcePolicy:value.resourcePolicy}:{}),...(value.computation?{computation:value.computation}:{})};cell={kind:'string',value:value.value.spelling};
 }else uncertaintyFailure('STATISTICAL_UNCERTAINTY_INPUT');
 if(!isScalarRepresentation(column))uncertaintyFailure('STATISTICAL_UNCERTAINTY_INPUT');if(resolve){column=await resolveScalarDefinitions(materials,column,{signal,budget});cell=await resolveScalarOperand(materials,cell,column,{signal,policy,budget});}signal?.throwIfAborted();await check();return {value:{spelling:cell.value,representation:column.representation,radix:column.radix},column};
}
export async function uncertaintyOperand(materials,value,resourcePolicy,options={}){
 if(value.kind==='cell')return uncertaintySource(materials,value.source,{...options,policy:options.policy??resourcePolicy});
 return {value:value.scalar,column:{...defaultColumn({label:'Declared model value'}),representation:value.scalar.representation,radix:value.scalar.radix,resourcePolicy,quantity:{origin:'derived',conversion:null,calibration:null,unitDefinition:value.unitDefinition}}};
}
export class StatisticalUncertaintyDefinitions{
 constructor(materials){this.materials=materials;this.sequences=materials.sequences;}
 descriptor(content,collection){if(!slots[collection])uncertaintyFailure();const value=content[slots[collection]];this.sequences.validate(value);if(value.kind!==kinds[collection])uncertaintyFailure('MATERIAL_MISSING');return value;}
 async empty(collection){return this.sequences.builder(kinds[collection],fn=>fn()).finish();}
 shape(doc,{complete=false}={}){
  const c=doc.content;if(doc.kind!=='analysis'||c.tool!==UNCERTAINTY_DEFINITION_TOOL||c.version!==1||!validStatisticalUncertaintyDefinition(c.definition,{complete}))uncertaintyFailure();const inputs=this.descriptor(c,'inputs'),covariance=this.descriptor(c,'covariance'),total=statisticalUncertaintyCovarianceCount(inputs.count);if(covariance.count>total||complete&&(!inputs.count||covariance.count!==total))uncertaintyFailure('STATISTICAL_UNCERTAINTY_INVALID');return {inputs,covariance};
 }
 async read(ref,options={}){const doc=await this.materials.read(ref);await this.materials.assertOwner(doc.recordId);await assertStatisticalUncertaintyFormat(this.materials.workspace);this.shape(doc,options);return doc;}
 async entry(content,collection,offset,{resolve=false,signal,budget}={}){
  const descriptor=this.descriptor(content,collection);if(!natural(offset)||offset>=descriptor.count)uncertaintyFailure();const saved=await this.sequences.item(descriptor,offset),kind=collection==='inputs'?'statistical-uncertainty-input':'statistical-uncertainty-covariance';
  if(!exact(saved,['version','kind','resourcePolicy','item'])||saved.version!==1||saved.kind!==kind||!validDatasetResourcePolicy(saved.resourcePolicy)||!(collection==='inputs'?validStatisticalUncertaintyInput(saved.item,saved.resourcePolicy):validStatisticalUncertaintyCovariance(saved.item,saved.resourcePolicy))||collection==='covariance'&&(statisticalUncertaintyCovariancePosition(saved.item.i,saved.item.j)!==offset||saved.item.j>=this.descriptor(content,'inputs').count))uncertaintyFailure('MATERIAL_MISSING');
  return resolve?resolveScalarDefinitions(this.materials,saved,{signal,budget}):saved;
 }
 async *references(content,{signal}={}){
  if(content.definition.nominal)yield content.definition.nominal.ref;
  for(const collection of ['inputs','covariance'])for(let at=0;at<this.descriptor(content,collection).count;at++){
   signal?.throwIfAborted();const {item}=await this.entry(content,collection,at,{signal});if(collection==='inputs')yield item.estimate.ref;const value=collection==='inputs'?item.sensitivity:item.value;if(value.kind==='cell')yield value.source.ref;
  }
 }
 async inputs(content,{signal}={}){return withScratch(async work=>{const builder=this.sequences.builder('references',fn=>fn());for await(const ref of this.references(content,{signal})){await this.materials.checkReference(ref);if(await work.add(materialReferenceKey(ref)))await builder.append(materialReference(ref));}return builder.finish();},{signal});}
 async authorizeItem(item,collection,policy,options={}){
  if(collection==='inputs')await uncertaintySource(this.materials,item.estimate,{...options,policy});const value=collection==='inputs'?item.sensitivity:item.value;if(value.kind==='cell')await uncertaintySource(this.materials,value.source,{...options,policy});
 }
 async create({recordId,title,definition},{signal}={}){
  if(!validStatisticalUncertaintyDefinition(definition))uncertaintyFailure();return this.materials.workspace.withLock(async()=>{await this.materials.assertOwner(recordId,{write:true});if(definition.nominal)await uncertaintySource(this.materials,definition.nominal,{signal,policy:definition.resourcePolicy});const content={tool:UNCERTAINTY_DEFINITION_TOOL,version:1,definition:structuredClone(definition),uncertaintyInputsIndex:await this.empty('inputs'),uncertaintyCovarianceIndex:await this.empty('covariance')};content.inputsIndex=await this.inputs(content,{signal});return this.materials.commit({kind:'analysis',recordId,title,content});});
 }
 async change(command,{signal}={}){
  const {ref,collection,offset,item,remove=false}=command;return this.materials.workspace.withLock(async()=>{const doc=await this.read(ref);await this.materials.assertOwner(doc.recordId,{write:true});if((await this.materials.current(doc.id))?.revision!==ref.revision)uncertaintyFailure('MATERIAL_CHANGED');const content=structuredClone(doc.content);
   if(collection==='settings'){if(!validStatisticalUncertaintyDefinition(command.definition))uncertaintyFailure();content.definition=structuredClone(command.definition);if(content.definition.nominal)await uncertaintySource(this.materials,content.definition.nominal,{signal,policy:content.definition.resourcePolicy});}
   else{
    const descriptor=this.descriptor(content,collection);if(!natural(offset)||offset>descriptor.count||remove&&offset!==descriptor.count-1)uncertaintyFailure();
    if(remove){if(item!==undefined||collection==='inputs'&&this.descriptor(content,'covariance').count>statisticalUncertaintyCovarianceCount(descriptor.count-1))uncertaintyFailure();content[slots[collection]]=await changeGraphSequence(this.sequences,descriptor,offset,undefined,{remove:true});}
    else{
     const policy=content.definition.resourcePolicy;if(!(collection==='inputs'?validStatisticalUncertaintyInput(item,policy):validStatisticalUncertaintyCovariance(item,policy)))uncertaintyFailure();if(collection==='covariance'&&(item.j>=this.descriptor(content,'inputs').count||statisticalUncertaintyCovariancePosition(item.i,item.j)!==offset))uncertaintyFailure();
     const prior=offset<descriptor.count?await this.entry(content,collection,offset,{signal}):undefined;if(collection==='inputs'&&prior&&prior.item.id!==item.id)uncertaintyFailure();if(collection==='inputs')for(let at=0;at<descriptor.count;at++){signal?.throwIfAborted();if(at===offset)continue;const previous=(await this.entry(content,collection,at,{signal})).item;if(previous.id===item.id||estimateKey(previous.estimate)===estimateKey(item.estimate))uncertaintyFailure();}
     const saved=await retainScalarDefinitions(this.materials,{version:1,kind:collection==='inputs'?'statistical-uncertainty-input':'statistical-uncertainty-covariance',resourcePolicy:policy,item:structuredClone(item)},fn=>fn(),{signal,base:prior});await this.authorizeItem(item,collection,policy,{signal});content[slots[collection]]=await changeGraphSequence(this.sequences,descriptor,offset,saved);
    }
   }
   this.shape({...doc,content});content.inputsIndex=await this.inputs(content,{signal});return this.materials.commit({kind:'analysis',id:doc.id,recordId:doc.recordId,title:command.title??doc.title,expectedRevision:ref.revision,content});
  });
 }
 async page({ref,collection='inputs',offset=0,limit=16},{signal}={}){return this.materials.workspace.withCatalogueConnections(async()=>{
  if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>16)uncertaintyFailure();const doc=await this.read(ref),c=doc.content,descriptor=this.descriptor(c,collection);if(offset>descriptor.count)uncertaintyFailure();if(c.definition.nominal)await uncertaintySource(this.materials,c.definition.nominal,{signal,policy:c.definition.resourcePolicy});const items=[];
  for(let at=offset;at<Math.min(offset+limit,descriptor.count);at++){const saved=await this.entry(c,collection,at,{signal});await this.authorizeItem(saved.item,collection,saved.resourcePolicy,{signal});items.push(saved.item);}
  return {ref,title:doc.title,recordId:doc.recordId,isCurrent:(await this.materials.current(doc.id))?.revision===ref.revision,definition:c.definition,inputCount:this.descriptor(c,'inputs').count,covarianceCount:this.descriptor(c,'covariance').count,items,offset,total:descriptor.count,next:offset+items.length<descriptor.count?offset+items.length:null};
 });}
 async scalar({ref,collection,offset,field,characterOffset=0,limit=4096},{signal}={}){return this.materials.workspace.withCatalogueConnections(async()=>{const doc=await this.read(ref),saved=await this.entry(doc.content,collection,offset,{signal});await this.authorizeItem(saved.item,collection,saved.resourcePolicy,{signal});return readScalarDefinition(this.materials,saved,'item.'+field,{offset:characterOffset,limit,signal});});}
 async validateSources(doc,{complete=false,semantic=false,signal,check}={}){
  this.shape(doc,{complete});const c=doc.content,options={signal,check,policy:c.definition.resourcePolicy};if(c.definition.nominal)await uncertaintySource(this.materials,c.definition.nominal,options);
  return withScratch(async work=>{for(const collection of ['inputs','covariance'])for(let at=0;at<this.descriptor(c,collection).count;at++){signal?.throwIfAborted();const saved=await this.entry(c,collection,at,{resolve:semantic,signal});if(collection==='inputs'&&(!await work.add('input:'+saved.item.id)||!await work.add('estimate:'+estimateKey(saved.item.estimate))))uncertaintyFailure();await this.authorizeItem(saved.item,collection,saved.resourcePolicy,options);}},{signal});
 }
 async verify(doc,{signal}={}){await assertStatisticalUncertaintyFormat(this.materials.workspace);await this.validateSources(doc,{signal,semantic:true});await withScratch(async work=>{let expected=0,actual=0;for await(const ref of this.references(doc.content,{signal}))if(await work.add('expected:'+materialReferenceKey(ref)))expected++;for await(const ref of this.materials.references(doc.content)){if(!await work.has('expected:'+materialReferenceKey(ref)))uncertaintyFailure('MATERIAL_MISSING');if(await work.add('actual:'+materialReferenceKey(ref)))actual++;}if(actual!==expected)uncertaintyFailure('MATERIAL_MISSING');},{signal});}
}
