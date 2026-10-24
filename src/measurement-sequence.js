// Structural sequence operations preserve exact spelling and source ordinals.
// There is no implicit parsing of a symbol, alignment, unit conversion or padding.
import {createHash} from 'node:crypto';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy,DatasetResourceError} from './web/dataset-resource-policy.js';
import {validatePolicyScalar,withScalarPolicy,scalarTextReference,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {validUnitDefinition,unitScalar,sameUnitDimensions} from './web/measurement-unit-model.js';
import {revisionText} from './web/revision-model.js';
import {MeasurementSequenceError,validSequenceDefinition,sameSequenceSpace,sequenceCount,sequenceOperationShape} from './web/measurement-sequence-model.js';
export {MeasurementSequenceError} from './web/measurement-sequence-model.js';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=(code='MEASUREMENT_SEQUENCE_INPUT')=>{throw new MeasurementSequenceError(code);};
const resource=()=>{throw new DatasetResourceError();};
const sameRatio=(a,b)=>a.numerator===b.numerator&&a.denominator===b.denominator;
// Each source has a resolved declaration/count/unit context and an authenticated
// immutable readPage({offset,limit,budget,signal}) adapter. resolveSpelling, when
// present, resolves one existing scalar-text reference; its digest is rechecked.
// iterateSequence yields {index,spelling,source:{operand,index}} and returns the
// final descriptor. evaluateSequence consumes that iterator through write().
export async function* iterateSequence(operation,sources,{resourcePolicy,budget:provided,signal,check,progress}={}){
 if(!validDatasetResourcePolicy(resourcePolicy)||!Array.isArray(sources)||sources.length<1||sources.length>2||!Array.from(sources).every(source=>source&&validSequenceDefinition(source.definition)&&sequenceCount(source.count)&&typeof source.readPage==='function'&&typeof source.unit==='string'&&source.unit.length<=100&&Object.hasOwn(source,'unitDefinition')))fail('MEASUREMENT_SEQUENCE_INVALID');
 if(provided!==undefined&&(!(provided instanceof DatasetResourceBudget)||revisionText(provided.scalarPolicy)!==revisionText(resourcePolicy)))fail('MEASUREMENT_SEQUENCE_INVALID');
 const shape=sequenceOperationShape(operation,sources.map(source=>source.count));
 const budget=provided??new DatasetResourceBudget(resourcePolicy),output=sources[0],samePolicy=sources.map(source=>revisionText(source.definition.resourcePolicy)===revisionText(output.definition.resourcePolicy));
 const run=(operation,code='MEASUREMENT_SEQUENCE_INPUT')=>{signal?.throwIfAborted();try{return numericalOperation(budget,operation);}catch(error){if(error instanceof MeasurementSequenceError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail(code);}};
 const current=async()=>{signal?.throwIfAborted();await check?.();signal?.throwIfAborted();},io=async operation=>{await current();const result=await operation();await current();return result;};
 await current();
 const units=sources.map(source=>run(b=>{
  b.step();if(source.definition.element.kind==='symbol'){if(source.unit!==''||source.unitDefinition!==null)fail('MEASUREMENT_SEQUENCE_UNITS');return null;}
  if(source.unitDefinition===null){if(source.unit!=='')fail('MEASUREMENT_SEQUENCE_UNITS');return null;}
  const definition=source.unitDefinition;if(!validUnitDefinition(definition))fail('MEASUREMENT_SEQUENCE_UNITS');const scale=unitScalar(definition.scale,b,definition.resourcePolicy),offset=unitScalar(definition.offset,b,definition.resourcePolicy);if(scale.numerator<=0n||definition.kind==='difference'&&offset.numerator!==0n)fail('MEASUREMENT_SEQUENCE_UNITS');return {definition,scale,offset};
 },'MEASUREMENT_SEQUENCE_UNITS'));
 if(sources.length===2){if(!sameSequenceSpace(output.definition,sources[1].definition))fail('MEASUREMENT_SEQUENCE_INCOMPATIBLE');const [a,b]=units;if(!!a!==!!b||a&&(a.definition.kind!==b.definition.kind||!sameUnitDimensions(a.definition,b.definition)||!sameRatio(a.scale,b.scale)||!sameRatio(a.offset,b.offset)))fail('MEASUREMENT_SEQUENCE_UNITS');}
 const declaration={definition:structuredClone(output.definition),unit:output.unit,unitDefinition:structuredClone(output.unitDefinition)};
 if(shape.kind==='length'){const spelling=String(output.count);run(b=>validatePolicyScalar({spelling,representation:'integer',radix:10},resourcePolicy,{budget:b}));await current();return {kind:'length',spelling,representation:'integer',radix:10,source:{operand:0,count:output.count}};}
 let cache=null;
 async function read(operand,index){
  const source=sources[operand],offset=Math.floor(index/16)*16;
  if(!cache||cache.operand!==operand||cache.offset!==offset){const limit=Math.min(16,source.count-offset),page=await io(()=>source.readPage({offset,limit,budget,signal}));if(!page||page.offset!==offset||page.total!==source.count||!Array.isArray(page.items)||page.items.length!==limit||page.next!==(offset+limit<source.count?offset+limit:null))fail();cache={operand,offset,items:page.items};}
  const item=cache.items[index-offset];if(!exact(item,['spelling']))fail();let spelling=item.spelling;
  if(spelling!==null&&typeof spelling!=='string'){
   if(!scalarTextReference(spelling)||typeof source.resolveSpelling!=='function')fail();if(spelling.characters>Math.min(source.definition.resourcePolicy.resources.maxScalarCharacters,output.definition.resourcePolicy.resources.maxScalarCharacters,resourcePolicy.resources.maxScalarCharacters))resource();
   const reference=spelling;spelling=await io(()=>source.resolveSpelling(reference,{budget,signal}));run(b=>{b.step();if(typeof spelling!=='string'||spelling.length!==reference.characters||createHash('sha256').update(Buffer.from(spelling,'utf16le')).digest('hex')!==reference.sha256)fail();});
  }
  run(b=>{
   b.step();if(spelling===null)return;if(typeof spelling!=='string')fail();const element=source.definition.element;
   const validate=policy=>{if(element.kind==='numeric')validatePolicyScalar({spelling,representation:element.representation,radix:element.radix},policy,{budget:b});else withScalarPolicy(policy,b,own=>{if(spelling.length>own.scalarPolicy.resources.maxScalarCharacters)resource();for(let i=0;i<spelling.length;i++)own.step();});};
   validate(source.definition.resourcePolicy);if(!samePolicy[operand])validate(output.definition.resourcePolicy);
  });
  return {spelling,source:{operand,index}};
 }
 if(shape.kind==='element'){const value=await read(0,operation.index);await current();return {kind:'element',...declaration,...value};}
 let complete=true;
 try{for(let index=0;index<shape.count;index++){
  let operand=0,position=index;if(operation.kind==='slice')position=operation.start+index;else if(operation.kind==='reverse')position=output.count-1-index;else if(operation.kind==='concatenate'&&index>=output.count){operand=1;position=index-output.count;}
  const value=await read(operand,position);complete&&=value.spelling!==null;await current();yield {index,...value};await current();if(progress&&((index+1)%32===0||index+1===shape.count))await io(()=>progress({done:index+1,total:shape.count}));
 }
 await current();return {kind:'sequence',...declaration,count:shape.count,complete};}finally{cache=null;}
}
// Callback compatibility is a thin consumer of the same pull implementation.
// Both output styles perform I/O outside the owned numerical run scopes.
export async function evaluateSequence(operation,sources,options={}){
 if(!validDatasetResourcePolicy(options.resourcePolicy)||['slice','concatenate','reverse'].includes(operation?.kind)&&typeof options.write!=='function')fail('MEASUREMENT_SEQUENCE_INVALID');
 const budget=options.budget??new DatasetResourceBudget(options.resourcePolicy),iterator=iterateSequence(operation,sources,{...options,budget});
 try{for(;;){const next=await iterator.next();if(next.done)return next.value;await options.write(next.value,{budget,signal:options.signal});}}finally{await iterator.return();}
}
