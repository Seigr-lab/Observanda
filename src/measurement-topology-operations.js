// Graph results expose only the explicitly declared combinatorial structure.
import {AppError} from './errors.js';
import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {defaultColumn} from './web/dataset-schema.js';
import {blankQuantity} from './web/measurement-model.js';
import {MeasurementTopologyError,validTopologyDefinition,validTopologyGraphOperation,topologyDirectionAllowed,topologyVertexSequenceDefinition} from './web/measurement-topology-model.js';
import {evaluateTopology,iterateTopologyVertices} from './measurement-topology.js';
import {validateTopologyValue} from './measurement-topology-storage.js';
import {retainSequenceElements} from './measurement-sequence-storage.js';
import {withScratch} from './scratch-work.js';
const fail=(code='MEASUREMENT_TOPOLOGY_INVALID')=>{throw new AppError(code);};
const handled=error=>{if(error instanceof MeasurementTopologyError)fail(error.code);throw error;};
export function topologyOperationColumn(node,column,{policy}={}){
 if(!validTopologyGraphOperation(node.operation)||!validDatasetResourcePolicy(policy)||column?.representation!=='domain'||!validTopologyDefinition(column.domain))fail();
 if(column.unit!==''||column.quantity?.unitDefinition!==undefined&&column.quantity.unitDefinition!==null)fail('MEASUREMENT_TOPOLOGY_UNITS');
 if(node.operation.kind!=='count'&&!topologyDirectionAllowed(column.domain,node.operation.direction))fail('MEASUREMENT_TOPOLOGY_DIRECTION');
 const common={...defaultColumn({label:column.name||'Topology result'}),quantity:{...blankQuantity(),origin:'derived'}};
 return ['neighbors','reachability'].includes(node.operation.kind)?{...common,representation:'domain',domain:topologyVertexSequenceDefinition(column.domain)}:{...common,representation:'integer',radix:10,resourcePolicy:structuredClone(policy)};
}
export async function calculateTopologyNode(materials,node,cell,column,{policy,budget:provided,work,write=operation=>operation(),signal,check=async()=>{}}={}){
 try{
  const output=topologyOperationColumn(node,column,{policy});signal?.throwIfAborted();await check();if(!cell||['absent','null'].includes(cell.kind)||typeof cell.value==='string'&&column.missing?.some(item=>item.value===cell.value))return {kind:'absent',value:''};
  const value=validateTopologyValue(materials,cell.value,column.domain),budget=provided??new DatasetResourceBudget(policy),source={definition:value.definition,vertexCount:value.topology.vertices.count,edgeCount:value.topology.edges.count,readVertices:({offset,limit})=>materials.sequences.page(value.topology.vertices,{offset,limit}),readEdges:({offset,limit})=>materials.sequences.page(value.topology.edges,{offset,limit})};
  const execute=async owner=>{
   const options={resourcePolicy:policy,budget,work:owner,signal,check},operation=node.operation;
   if(!['neighbors','reachability'].includes(operation.kind)){const result=await evaluateTopology(operation.kind==='count'?{kind:'counts'}:operation,source,options);return {kind:'string',value:operation.kind==='count'?result[operation.collection].spelling:operation.kind==='reachable'?(result.value?'1':'0'):result.spelling};}
   const iterator=iterateTopologyVertices(operation,source,options);let summary;
   async function* items(){for(;;){const next=await iterator.next();if(next.done){summary=next.value;return;}yield {spelling:next.value.spelling};}}
   try{const result=await retainSequenceElements(materials,output.domain,items(),write,{budget,signal,check});if(summary?.kind!=='sequence'||result.count!==summary.count||!result.complete)fail('MATERIAL_MISSING');return {kind:'string',value:result};}finally{await iterator.return();}
  };
  return await (work?execute(work):withScratch(execute,{signal}));
 }catch(error){handled(error);}
}
