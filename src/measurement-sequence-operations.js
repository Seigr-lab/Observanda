// Sequence graph nodes preserve the declared element space and original ordinals.
// Output elements stream directly into existing retained component/text storage.
import {AppError} from './errors.js';
import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {defaultColumn} from './web/dataset-schema.js';
import {blankQuantity} from './web/measurement-model.js';
import {defaultDomain} from './web/measurement-domain-model.js';
import {MeasurementSequenceError,validSequenceDefinition,validSequenceOperation} from './web/measurement-sequence-model.js';
import {evaluateSequence,iterateSequence} from './measurement-sequence.js';
import {validateSequenceValue,retainSequenceElements} from './measurement-sequence-storage.js';
import {retainDomainValue} from './measurement-domain-storage.js';
import {resolveScalarDefinitions} from './measurement-scalar-storage.js';
import {graphScalarCell} from './dataset-resource-values.js';
const fail=(code='MEASUREMENT_SEQUENCE_INVALID')=>{throw new AppError(code);};
const handled=error=>{if(error instanceof MeasurementSequenceError)fail(error.code);throw error;};
function declarations(node,columns,policy){
 if(!validSequenceOperation(node.operation)||!validDatasetResourcePolicy(policy)||!Array.isArray(columns)||columns.length!==(node.operation.kind==='concatenate'?2:1)||columns.some(column=>column?.representation!=='domain'||!validSequenceDefinition(column.domain)))fail();
 return columns.map(column=>({definition:column.domain,count:0,unit:column.unit,unitDefinition:column.quantity?.unitDefinition??null,readPage:async()=>{throw new AppError('MATERIAL_MISSING');}}));
}
export async function sequenceOperationColumn(node,columns,{policy,budget,signal,check}={}){
 try{
  const sources=declarations(node,columns,policy),kind=node.operation.kind;
  await evaluateSequence({kind:sources.length===2?'concatenate':'slice',...(sources.length===1?{start:0,count:0}:{})},sources,{resourcePolicy:policy,budget,write:async()=>{},signal,check});
  const source=columns[0],quantity={...(source.quantity??blankQuantity()),origin:'derived'};
  if(kind==='length')return {...defaultColumn({label:'Sequence length'}),representation:'integer',radix:10,resourcePolicy:structuredClone(policy),quantity:{...blankQuantity(),origin:'derived'}};
  if(kind==='index'){
   const element=source.domain.element;
   if(element.kind==='symbol')return {...defaultColumn({label:'Sequence element'}),representation:'domain',domain:{...defaultDomain('symbol'),namespace:source.domain.namespace},quantity:{...blankQuantity(),origin:'derived'}};
   return {...defaultColumn({label:'Sequence element'}),representation:element.representation,radix:element.radix,unit:source.unit,quantity,resourcePolicy:structuredClone(source.domain.resourcePolicy)};
  }
  return {...defaultColumn({label:source.name||'Sequence'}),representation:'domain',domain:structuredClone(source.domain),unit:source.unit,quantity};
 }catch(error){handled(error);}
}
const present=(cell,column)=>cell&&!['absent','null'].includes(cell.kind)&&!(typeof cell.value==='string'&&column.missing?.some(item=>item.value===cell.value));
export async function calculateSequenceNode(materials,node,cells,columns,{policy,budget:provided,write=operation=>operation(),signal,check=async()=>{}}={}){
 try{
  const budget=provided??new DatasetResourceBudget(policy),resolved=[];
  for(const column of columns)resolved.push(await resolveScalarDefinitions(materials,column,{signal,budget}));
  const output=await sequenceOperationColumn(node,resolved,{policy,budget,signal,check});if(!Array.isArray(cells)||cells.length!==resolved.length)fail();
  signal?.throwIfAborted();await check();if(cells.some((cell,index)=>!present(cell,resolved[index])))return {kind:'absent',value:''};
  const values=cells.map((cell,index)=>validateSequenceValue(materials,cell.value,resolved[index].domain)),sources=values.map((value,index)=>({definition:value.definition,count:value.count,unit:resolved[index].unit,unitDefinition:resolved[index].quantity?.unitDefinition??null,
   readPage:({offset,limit})=>materials.sequences.page(value.components,{offset,limit}),
   resolveSpelling:async(reference,options)=>(await graphScalarCell(materials,{kind:'string',value:reference},value.definition.resourcePolicy,options)).value
  }));
  const iterator=iterateSequence(node.operation,sources,{resourcePolicy:policy,budget,signal,check});let result;
  try{
   if(['length','index'].includes(node.operation.kind)){
    const next=await iterator.next();if(!next.done)fail('MATERIAL_MISSING');result=next.value;
    if(result.kind==='element'&&result.spelling===null)return {kind:'null',value:''};
    if(result.kind==='length'||resolved[0].domain.element.kind==='numeric')return {kind:'string',value:result.spelling};
    return {kind:'string',value:await retainDomainValue(materials,{kind:'string',value:result.spelling},output.domain,write,{signal})};
   }
   async function* items(){for(;;){const next=await iterator.next();if(next.done){result=next.value;return;}yield {spelling:next.value.spelling};}}
   const value=await retainSequenceElements(materials,output.domain,items(),write,{budget,signal,check});
   if(result?.kind!=='sequence'||result.count!==value.count||result.complete!==value.complete)fail('MATERIAL_MISSING');return {kind:'string',value};
  }finally{await iterator.return();}
 }catch(error){handled(error);}
}
