// Exact affine frame changes reuse retained domain values, scalar policies and
// unit arithmetic. Matrix rows follow target axes; columns follow source axes.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {defaultDatasetResourcePolicy,validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {validCoordinateFrame,validCoordinateFrameAxis,validCoordinateFrameTransform,validCoordinateFrameDescriptor,COORDINATE_FRAME_TOOL,COORDINATE_FRAME_TRANSFORM_TOOL,COORDINATE_FRAME_METHOD,CoordinateFrameError} from './web/coordinate-frame-model.js';
import {knownDomain,domainCodec,domainUsesResourcePolicy} from './web/measurement-domain-model.js';
import {validUnitDefinition,unitScalar,sameUnitDimensions} from './web/measurement-unit-model.js';
import {addPlotRational,multiplyPlotRational,dividePlotRational,plotRational,plotRationalText} from './web/plot-resource-policy.js';
import {validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {validComputation,derivedComputation} from './web/measurement-computation.js';
import {materialReference,materialReferenceKey,validMaterialReference} from './web/material-reference.js';
import {revisionText} from './web/revision-model.js';
import {defaultColumn} from './web/dataset-schema.js';
import {resolveScalarDefinitions,resolveScalarOperand} from './measurement-scalar-storage.js';
import {projectDatasetRows} from './dataset-storage.js';
import {validateDomainValue,domainValueSupported,retainDomainComponents} from './measurement-domain-storage.js';
const fail=(code='COORDINATE_FRAME_INVALID')=>{throw code.startsWith('COORDINATE_FRAME_')?new CoordinateFrameError(code):new AppError(code);};
const zero=()=>({numerator:0n,denominator:1n});
const subtract=(a,b,budget)=>addPlotRational(a,{numerator:-b.numerator,denominator:b.denominator},budget);
const sameRef=(a,b)=>!!a&&!!b&&materialReferenceKey(a)===materialReferenceKey(b);
const present=(cell,column)=>cell&&!['null','absent'].includes(cell.kind)&&!column.missing?.some(item=>item.value===cell.value);
function handled(error){if(error instanceof AppError||error instanceof CoordinateFrameError||typeof error?.code==='string'||error.name==='AbortError'||isScalarResourceFailure(error))throw error;fail();}
function operationBudget(policy,consumer,caller){
 if(!validDatasetResourcePolicy(policy)||consumer!==undefined&&!validDatasetResourcePolicy(consumer))fail();const selected=structuredClone(policy);
 for(const other of [consumer,caller?.scalarPolicy].filter(Boolean))for(const key of Object.keys(selected.resources))selected.resources[key]=Math.min(selected.resources[key],other.resources[key]);
 const owner=new DatasetResourceBudget(selected);if(!caller)return owner;
 return {scalarPolicy:selected,maxBits:Math.min(owner.maxBits,caller.maxBits),run:operation=>owner.run(()=>caller.run(operation)),step(){owner.step();caller.step();},size(...values){owner.size(...values);caller.size(...values);},product(a,b){const value=owner.product(a,b);caller.step();caller.size(value);return value;},power(a,n){const value=owner.power(a,n);caller.step();caller.size(value);return value;}};
}
async function current(options){options.signal?.throwIfAborted();await options.check?.();options.signal?.throwIfAborted();}
const run=(options,operation)=>numericalOperation(options.budget,operation);
async function document(materials,ref,options){await current(options);const doc=await materials.read(ref);if(typeof materials.assertOwner==='function')await materials.assertOwner(doc.recordId);await current(options);return doc;}
function unit(definition,options){return run(options,b=>{
 if(!definition||![1,2].includes(definition.version)||definition.kind!=='difference')fail('COORDINATE_FRAME_UNITS');
 if(definition.version===1&&(!['scale','offset'].every(key=>typeof definition[key]?.spelling==='string'&&definition[key].spelling.length<=8192)||Object.hasOwn(definition,'resourcePolicy')))fail('COORDINATE_FRAME_UNITS');
 const view=definition.version===1?{...definition,version:2,resourcePolicy:options.budget.scalarPolicy}:definition;
 if(!validUnitDefinition(view))fail('COORDINATE_FRAME_UNITS');const scale=unitScalar(definition.scale,b,view.resourcePolicy),offset=unitScalar(definition.offset,b,view.resourcePolicy);
 if(scale.numerator<=0n||offset.numerator!==0n)fail('COORDINATE_FRAME_UNITS');return scale;
});}
function compatible(left,right){if(!sameUnitDimensions(left,right))fail('COORDINATE_FRAME_UNITS');}
function frameColumn(column,frame,ref){
 if(column?.representation!=='domain'||!knownDomain(column.domain)||domainCodec(column.domain)!=='vector'||column.domain.shape[0]!==frame.dimension||column.domain.namespace!==frame.namespace||!validCoordinateFrameDescriptor(column.coordinateFrame)||!sameRef(column.coordinateFrame.frame,ref))fail('COORDINATE_FRAME_INCOMPATIBLE');
 if(column.computation!==undefined&&!validComputation(column.computation))fail();compatible(column.quantity?.unitDefinition,frame.unitDefinition);
}
class Components{
 constructor(materials,cell,column,options){Object.assign(this,{materials,column,options});this.value=validateDomainValue(materials,cell.value,column.domain);if(!domainValueSupported(this.value))fail('MEASUREMENT_DOMAIN_UNSUPPORTED');this.page=null;}
 async read(index){
  const {materials,column,options,value}=this;await current(options);const offset=Math.floor(index/16)*16;
  if(!Number.isSafeInteger(index)||index<0||index>=value.components.count)fail('MATERIAL_MISSING');
  if(!this.page||this.page.offset!==offset){this.page=await materials.sequences.page(value.components,{offset,limit:16});await current(options);if(this.page.offset!==offset||this.page.items.length!==Math.min(16,value.components.count-offset))fail('MATERIAL_MISSING');}
  const item=this.page.items[index-offset];if(!item||Object.keys(item).length!==1||!Object.hasOwn(item,'spelling'))fail('MATERIAL_MISSING');run(options,b=>b.step());if(item.spelling===null)return null;
  const policy=domainUsesResourcePolicy(column.domain)?column.domain.resourcePolicy:defaultDatasetResourcePolicy(),component=column.domain.component,selected=await resolveScalarOperand(materials,{kind:'string',value:item.spelling},{representation:component.representation,radix:component.radix,missing:[],resourcePolicy:policy},{...options,policy});await current(options);
  return run(options,b=>validatePolicyScalar({spelling:selected.value,representation:component.representation,radix:component.radix},policy,{budget:b}));
 }
}
function scratch(work,prefix,options){
 if(typeof work?.get!=='function'||typeof work?.put!=='function')fail();
 return {async put(key,value){await current(options);await work.put(prefix+key,value);await current(options);},async get(key){await current(options);const value=await work.get(prefix+key);await current(options);if(value===undefined)fail('MATERIAL_MISSING');return value;},async number(key){const value=await this.get(key);return value===null?null:run(options,b=>plotRational(value,b));}};
}
// Draft edits validate one bounded header. Complete scientific use additionally
// streams every axis through the caller's encrypted work store for uniqueness.
export async function validateCoordinateFrameDefinition(materials,content,{complete=false,scanAxes=false,work,policy,budget,signal,check}={}){
 try{
  if(!validCoordinateFrame(content,{complete}))fail();const options={signal,check,budget:operationBudget(content.resourcePolicy,policy,budget)};await current(options);
  const frame={...structuredClone(content),unitDefinition:await resolveScalarDefinitions(materials,content.unitDefinition,options)};unit(frame.unitDefinition,options);materials.sequences.validate(frame.axesIndex);
  if(scanAxes){const prefix='coordinate-frame-axes:'+randomUUID()+':',cache=complete?scratch(work,prefix,options):null;for(let i=0;i<frame.axesIndex.count;i++){await current(options);const axis=await materials.sequences.item(frame.axesIndex,i);if(!validCoordinateFrameAxis(axis))fail();run(options,b=>b.step());if(complete){const key='axis:'+axis.id;if(await work.get(prefix+key)!==undefined)fail();await cache.put(key,true);}}}
  await current(options);return frame;
 }catch(error){handled(error);}
}
async function readFrame(materials,ref,options,work){
 const doc=await document(materials,ref,options);if(doc.kind!=='analysis'||doc.content.tool!==COORDINATE_FRAME_TOOL)fail();
 return {ref:materialReference(ref),content:await validateCoordinateFrameDefinition(materials,doc.content,{...options,complete:true,scanAxes:true,work})};
}
// Schema/copy admission streams axis identities and checks bounded pins; it does not repeat
// matrix elimination for each column. Complete model verification owns that work.
export async function validateCoordinateFrameColumn(materials,column,{policy,budget,signal,check,work,requireAxes=false}={}){
 if(!work)return withScratch(work=>validateCoordinateFrameColumn(materials,column,{policy,budget,signal,check,work,requireAxes}),{signal});
 try{
  if(!validCoordinateFrameDescriptor(column?.coordinateFrame))fail();const descriptor=column.coordinateFrame,options={signal,check,budget},doc=await document(materials,descriptor.frame,options);
  if(doc.kind!=='analysis'||doc.content.tool!==COORDINATE_FRAME_TOOL)fail();
  const operation=operationBudget(doc.content.resourcePolicy,policy,budget);options.budget=operation;
  const frame=await validateCoordinateFrameDefinition(materials,doc.content,{...options,complete:true,scanAxes:true,work}),resolved=await resolveScalarDefinitions(materials,column,options);frameColumn(resolved,frame,descriptor.frame);unit(resolved.quantity?.unitDefinition,options);
  if(requireAxes&&!descriptor.axesIndex)fail();if(descriptor.axesIndex){materials.sequences.validate(descriptor.axesIndex);if(descriptor.axesIndex.count!==frame.dimension)fail();if(revisionText(descriptor.axesIndex)!==revisionText(frame.axesIndex))for(let at=0;at<frame.dimension;at++){await current(options);run(options,b=>b.step());const expected=await materials.sequences.item(frame.axesIndex,at),actual=await materials.sequences.item(descriptor.axesIndex,at);if(!validCoordinateFrameAxis(actual)||revisionText(expected)!==revisionText(actual))fail();}}
  if(descriptor.transform){const transform=await document(materials,descriptor.transform,options),content=transform.content;
   if(transform.kind!=='analysis'||content.tool!==COORDINATE_FRAME_TRANSFORM_TOOL||!validCoordinateFrameTransform(content)||!sameRef(content.sourceFrame,descriptor.sourceFrame)||!sameRef(content.targetFrame,descriptor.frame))fail();
   const source=await document(materials,descriptor.sourceFrame,options);if(source.kind!=='analysis'||source.content.tool!==COORDINATE_FRAME_TOOL)fail();const sourceFrame=await validateCoordinateFrameDefinition(materials,source.content,{...options,complete:true,scanAxes:true,work});if(sourceFrame.dimension!==frame.dimension)fail('COORDINATE_FRAME_INCOMPATIBLE');compatible(sourceFrame.unitDefinition,frame.unitDefinition);
  }
  await current(options);return resolved;
 }catch(error){handled(error);}
}
async function selectedDomain(materials,locator,options){
 const doc=await document(materials,locator.ref,options);let savedColumn,cell;
 if(doc.content?.datasetFormat===3){
  const {page,row,column}=locator.selector;await current(options);const metadata=await materials.retainedDatasetPage(doc,page,{metadataOnly:true}),selected=metadata.rows[row];await current(options);
  if(!selected||selected.excluded)fail('COORDINATE_FRAME_INPUT');savedColumn=await materials.datasetColumn(doc,column);const projected=await projectDatasetRows(materials,doc,[selected],[column]);await current(options);const value=projected.rows[0];cell={kind:value.valueKinds[0],value:value.cells[0]};
  if(!present(cell,savedColumn))fail('COORDINATE_FRAME_INPUT');
 }else{
  const selected=await materials.measurements.cell(locator);await current(options);if(selected.row.excluded||selected.value.presence!=='value')fail('COORDINATE_FRAME_INPUT');savedColumn=selected.column;cell={kind:'string',value:selected.cellReference??selected.value.spelling};
 }
 if(savedColumn.representation!=='domain')fail('COORDINATE_FRAME_INPUT');const column=await resolveScalarDefinitions(materials,savedColumn,options);if(column.computation!==undefined&&!validComputation(column.computation))fail();return {column,cell};
}
// The returned context is serializable and bounded. Its scratch prefix is valid
// only for the caller's owned work store; original A remains separate from rank work.
export async function verifyCoordinateFrameTransform(materials,content,{model,work,policy,budget,signal,check}={}){
 try{
  if(!validCoordinateFrameTransform(content)||model!==undefined&&(!validMaterialReference(model)||model.kind!=='analysis'))fail();
  const options={signal,check,budget:operationBudget(content.resourcePolicy,policy,budget)},prefix='coordinate-frame:'+randomUUID()+':',state=scratch(work,prefix,options);
  if(model&&revisionText((await document(materials,model,options)).content)!==revisionText(content))fail();
  const source=await readFrame(materials,content.sourceFrame,options,work,prefix+'source:'),target=await readFrame(materials,content.targetFrame,options,work,prefix+'target:');
  if(source.content.dimension!==target.content.dimension)fail('COORDINATE_FRAME_INCOMPATIBLE');compatible(source.content.unitDefinition,target.content.unitDefinition);const n=source.content.dimension;
  const matrix=await selectedDomain(materials,content.matrix,options),offset=await selectedDomain(materials,content.offset,options),shape=matrix.column.domain;
  if(!knownDomain(shape)||domainCodec(shape)!=='matrix'||shape.shape[0]!==n||shape.shape[1]!==n)fail('COORDINATE_FRAME_INCOMPATIBLE');
  const aScale=unit(matrix.column.quantity?.unitDefinition,options);if(matrix.column.quantity.unitDefinition.dimensions.length)fail('COORDINATE_FRAME_UNITS');frameColumn(offset.column,target.content,content.targetFrame);const bScale=unit(offset.column.quantity?.unitDefinition,options);
  const aReader=new Components(materials,matrix.cell,matrix.column,options),bReader=new Components(materials,offset.cell,offset.column,options);
  for(let i=0;i<n;i++){
   const offset=await bReader.read(i);if(offset===null)fail('COORDINATE_FRAME_INPUT');await state.put('b:'+i,run(options,b=>plotRationalText(multiplyPlotRational(offset,bScale,b),b)));
   for(let j=0;j<n;j++){const value=await aReader.read(i*n+j);if(value===null)fail('COORDINATE_FRAME_INPUT');const text=run(options,b=>plotRationalText(multiplyPlotRational(value,aScale,b),b));await state.put('a:'+i+':'+j,text);await state.put('rank:'+i+':'+j,text);}
  }
  // Exact row-pivot elimination, with no tolerance, implicit regularization or inverse.
  for(let k=0;k<n;k++){
   let pivotRow=k,pivot=await state.number('rank:'+k+':'+k);while(pivot.numerator===0n&&++pivotRow<n)pivot=await state.number('rank:'+pivotRow+':'+k);
   if(pivotRow===n)fail('COORDINATE_FRAME_SINGULAR');
   if(pivotRow!==k)for(let j=k;j<n;j++){const first=await state.get('rank:'+k+':'+j),second=await state.get('rank:'+pivotRow+':'+j);await state.put('rank:'+k+':'+j,second);await state.put('rank:'+pivotRow+':'+j,first);}
   for(let i=k+1;i<n;i++){
    const value=await state.number('rank:'+i+':'+k);if(value.numerator===0n)continue;const factor=run(options,b=>dividePlotRational(value,pivot,b));
    for(let j=k+1;j<n;j++){const prior=await state.number('rank:'+i+':'+j),coefficient=await state.number('rank:'+k+':'+j);await state.put('rank:'+i+':'+j,run(options,b=>plotRationalText(subtract(prior,multiplyPlotRational(factor,coefficient,b),b),b)));}
    await state.put('rank:'+i+':'+k,'0/1');
   }
  }
  await current(options);return {version:1,method:COORDINATE_FRAME_METHOD,model:model?materialReference(model):null,content:structuredClone(content),sourceFrame:source,targetFrame:target,dimension:n,prefix,...derivedComputation(matrix.column,offset.column)};
 }catch(error){handled(error);}
}
export function coordinateFrameTransformColumn(node,column,context,{policy,budget}={}){
 try{
  if(context?.version!==1||context.method!==COORDINATE_FRAME_METHOD||!validCoordinateFrameTransform(context.content)||!validMaterialReference(node?.model)||node.model.kind!=='analysis'||context.model&&!sameRef(context.model,node.model)||!validCoordinateFrame(context.sourceFrame?.content)||!validCoordinateFrame(context.targetFrame?.content)||!sameRef(context.sourceFrame.ref,context.content.sourceFrame)||!sameRef(context.targetFrame.ref,context.content.targetFrame)||context.dimension!==context.sourceFrame.content.dimension||context.dimension!==context.targetFrame.content.dimension)fail();
  const options={budget:operationBudget(context.content.resourcePolicy,policy,budget)},target=context.targetFrame.content;frameColumn(column,context.sourceFrame.content,context.sourceFrame.ref);unit(column.quantity?.unitDefinition,options);unit(target.unitDefinition,options);
  return {...defaultColumn({label:column.name||'Transformed coordinates'}),representation:'domain',unit:target.unit,quantity:{origin:'derived',conversion:materialReference(node.model),calibration:null,unitDefinition:structuredClone(target.unitDefinition)},domain:{version:2,codec:'observanda.vector',codecVersion:1,namespace:target.namespace,shape:[context.dimension],component:{version:1,representation:'rational',radix:10},resourcePolicy:structuredClone(options.budget.scalarPolicy)},coordinateFrame:{version:1,frame:materialReference(context.targetFrame.ref),axesIndex:structuredClone(target.axesIndex),sourceFrame:materialReference(context.sourceFrame.ref),transform:materialReference(node.model)},...derivedComputation(column,context)};
 }catch(error){handled(error);}
}
export async function calculateCoordinateFrameTransformNode(materials,node,cell,column,{verified,work,policy,budget,write=fn=>fn(),signal,check}={}){
 try{
  if(!verified||!work)fail();const options={signal,check,budget:operationBudget(verified.content.resourcePolicy,policy,budget)};
  for(const ref of [node.model,verified.content.sourceFrame,verified.content.targetFrame,verified.content.matrix.ref,verified.content.offset.ref]){const doc=await document(materials,ref,options);if(sameRef(ref,node.model)&&revisionText(doc.content)!==revisionText(verified.content))fail();const frame=sameRef(ref,verified.sourceFrame.ref)?verified.sourceFrame:sameRef(ref,verified.targetFrame.ref)?verified.targetFrame:null;if(frame){const currentFrame={...doc.content,unitDefinition:await resolveScalarDefinitions(materials,doc.content.unitDefinition,options)};if(revisionText(currentFrame)!==revisionText(frame.content))fail();}}
  column=await resolveScalarDefinitions(materials,column,options);const output=coordinateFrameTransformColumn(node,column,verified,{policy,budget:options.budget});
  if(!cell||cell.kind==='absent')return {kind:'absent',value:''};if(cell.kind==='null')return {kind:'null',value:''};if(!present(cell,column))return {kind:'absent',value:''};
  const inputId=randomUUID(),input=new Components(materials,cell,column,options),stored=scratch(work,verified.prefix,options),values=scratch(work,verified.prefix+'input:'+inputId+':',options),scale=unit(column.quantity.unitDefinition,options),targetScale=unit(verified.targetFrame.content.unitDefinition,options),n=verified.dimension;
  for(let j=0;j<n;j++){const value=await input.read(j);await values.put(String(j),value===null?null:run(options,b=>plotRationalText(multiplyPlotRational(value,scale,b),b)));}
  async function* components(){
   for(let i=0;i<n;i++){
    let sum=await stored.number('b:'+i),missing=false;
    for(let j=0;j<n;j++){const a=await stored.number('a:'+i+':'+j),x=await values.number(String(j));if(x===null)missing=true;else sum=run(options,b=>addPlotRational(sum,multiplyPlotRational(a,x,b),b));}
    const spelling=missing?null:run(options,b=>plotRationalText(dividePlotRational(sum,targetScale,b),b));await current(options);yield {spelling,budget:options.budget};
   }
  }
  const value=await retainDomainComponents(materials,output.domain,components(),write,{signal});if(typeof work.remove==='function')for(let j=0;j<n;j++){await current(options);await work.remove(verified.prefix+'input:'+inputId+':'+j);}await current(options);return {kind:'string',value};
 }catch(error){handled(error);}
}
