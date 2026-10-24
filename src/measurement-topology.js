// Exact declared topology only: no circuit, weight, isomorphism or geometry
// semantics. The caller supplies authenticated immutable pages and an existing
// encrypted scratch owner; this module introduces no persistence framework.
import {randomUUID} from 'node:crypto';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy,DatasetResourceError} from './web/dataset-resource-policy.js';
import {withScalarPolicy,validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {revisionText} from './web/revision-model.js';
import {MeasurementTopologyError,TOPOLOGY_PAGE_SIZE,validTopologyDefinition,validTopologyVertex,validTopologyEdge,validTopologyOperation,validTopologySequenceOperation,topologyDirectionAllowed,topologyCount,topologyVertexSequenceDefinition} from './web/measurement-topology-model.js';
export {MeasurementTopologyError} from './web/measurement-topology-model.js';
const fail=(code='MEASUREMENT_TOPOLOGY_INPUT')=>{throw new MeasurementTopologyError(code);};
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
// source: {definition,vertexCount,edgeCount,readVertices,readEdges}. Readers take
// {offset,limit<=16,budget,signal} and return {items,offset,total,next}. They are
// already bound to one authenticated immutable source; ordinal provenance below
// is resolved by that owner, never by matching a newly current material.
async function* topologyExecution(operation,source,{resourcePolicy,budget:provided,work,signal,check,progress,stream=false}={}){
 if(!(stream?validTopologySequenceOperation(operation):validTopologyOperation(operation))||!source||!validTopologyDefinition(source.definition)||!topologyCount(source.vertexCount)||!topologyCount(source.edgeCount)||typeof source.readVertices!=='function'||typeof source.readEdges!=='function'||!validDatasetResourcePolicy(resourcePolicy)||!work||!['get','put','add'].every(key=>typeof work[key]==='function'))fail('MEASUREMENT_TOPOLOGY_INVALID');
 if(operation.kind!=='counts'&&!topologyDirectionAllowed(source.definition,operation.direction))fail('MEASUREMENT_TOPOLOGY_DIRECTION');
 if(provided!==undefined&&(!(provided instanceof DatasetResourceBudget)||revisionText(provided.scalarPolicy)!==revisionText(resourcePolicy)))fail('MEASUREMENT_TOPOLOGY_INVALID');
 const budget=provided??new DatasetResourceBudget(resourcePolicy),prefix='topology:'+randomUUID()+':',directed=source.definition.direction==='directed';
 const run=fn=>{signal?.throwIfAborted();try{return numericalOperation(budget,fn);}catch(error){if(error instanceof MeasurementTopologyError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail();}};
 const current=async()=>{signal?.throwIfAborted();await check?.();signal?.throwIfAborted();},io=async fn=>{run(b=>b.step());await current();const result=await fn();await current();return result;};
 const get=id=>io(()=>work.get(prefix+id)),put=(id,value)=>io(()=>work.put(prefix+id,value)),add=(id,value)=>io(()=>work.add(prefix+id,value)),keyId=key=>'key:'+JSON.stringify(key),vertexId=index=>'vertex:'+index;
 const increment=value=>run(b=>{b.step();if(!Number.isSafeInteger(value+1))throw new DatasetResourceError();return value+1;});
 const scalar=value=>run(b=>{const result={spelling:String(value),representation:'integer',radix:10};validatePolicyScalar(result,resourcePolicy,{budget:b});return result;});
 function keys(item,fields){run(b=>withScalarPolicy(source.definition.resourcePolicy,b,own=>{for(const field of fields){const value=item[field];if(value.length>own.scalarPolicy.resources.maxScalarCharacters)throw new DatasetResourceError();for(let i=0;i<value.length;i++)own.step();}}));}
 async function page(kind,offset){const total=source[kind==='vertices'?'vertexCount':'edgeCount'],limit=Math.min(TOPOLOGY_PAGE_SIZE,total-offset),result=await io(()=>source[kind==='vertices'?'readVertices':'readEdges']({offset,limit,budget,signal}));if(!result||result.offset!==offset||result.total!==total||!Array.isArray(result.items)||result.items.length!==limit||result.next!==(offset+limit<total?offset+limit:null))fail();return result.items;}
 async function vertex(index){const value=await get(vertexId(index));if(!value||value.index!==index||!validTopologyVertex({key:value.key})||!['in','out','all','loops'].every(key=>topologyCount(value[key])))fail();return value;}
 async function adjacent(index,direction,neighbor,edge){const value=await vertex(index),at=value[direction];value[direction]=increment(at);await put('adj:'+direction+':'+index+':'+at,{neighbor,edge});await put(vertexId(index),value);}
 async function lookup(key){const value=await get(keyId(key));if(!value||!topologyCount(value.index)||value.index>=source.vertexCount)fail('MEASUREMENT_TOPOLOGY_KEY');return vertex(value.index);}
 await current();
 // Every vertex and edge is validated before counts, self-reach or any other
 // early result. Source page buffers never exceed sixteen authored records.
 for(let offset=0;offset<source.vertexCount;offset+=TOPOLOGY_PAGE_SIZE){const items=await page('vertices',offset);for(let local=0;local<items.length;local++){const item=items[local],index=offset+local;if(!validTopologyVertex(item))fail();keys(item,['key']);if(!await add(keyId(item.key),{index}))fail('MEASUREMENT_TOPOLOGY_DUPLICATE');await put(vertexId(index),{key:item.key,index,in:0,out:0,all:0,loops:0});}if(progress)await io(()=>progress({phase:'vertices',done:offset+items.length,total:source.vertexCount}));}
 for(let offset=0;offset<source.edgeCount;offset+=TOPOLOGY_PAGE_SIZE){const items=await page('edges',offset);for(let local=0;local<items.length;local++){
  const item=items[local],edge=offset+local;if(!validTopologyEdge(item))fail();keys(item,['key','from','to']);if(!await add('edge-key:'+JSON.stringify(item.key),{index:edge}))fail('MEASUREMENT_TOPOLOGY_DUPLICATE');const from=await get(keyId(item.from)),to=await get(keyId(item.to));if(!from||!to)fail('MEASUREMENT_TOPOLOGY_ENDPOINT');
  if(from.index===to.index&&source.definition.loops==='reject')fail('MEASUREMENT_TOPOLOGY_RULE');const pair=directed||from.index<=to.index?[from.index,to.index]:[to.index,from.index];if(source.definition.parallelEdges==='reject'&&!await add('pair:'+pair.join(':'),true))fail('MEASUREMENT_TOPOLOGY_RULE');
  await put('edge:'+edge,{key:item.key,from:from.index,to:to.index});if(directed){await adjacent(from.index,'out',to.index,edge);await adjacent(to.index,'in',from.index,edge);}else{await adjacent(from.index,'all',to.index,edge);if(from.index!==to.index)await adjacent(to.index,'all',from.index,edge);else{const value=await vertex(from.index);value.loops=increment(value.loops);await put(vertexId(from.index),value);}}
 }if(progress)await io(()=>progress({phase:'edges',done:offset+items.length,total:source.edgeCount}));}
 const sourceRef={operand:0};
 if(operation.kind==='counts'){const result={kind:'counts',vertices:scalar(source.vertexCount),edges:scalar(source.edgeCount),source:sourceRef};await current();return result;}
 const start=await lookup(operation.vertex??operation.from),directions=directed?(operation.direction==='all'?['out','in']:[operation.direction]):['all'];
 if(operation.kind==='degree'){const count=directed?operation.direction==='all'?BigInt(start.in)+BigInt(start.out):BigInt(start[operation.direction]):BigInt(start.all)+BigInt(start.loops),result={kind:'degree',...scalar(count),direction:operation.direction,source:{operand:0,vertex:start.index}};await current();return result;}
 async function* links(value){for(const direction of directions)for(let offset=0;offset<value[direction];offset++){const item=await get('adj:'+direction+':'+value.index+':'+offset);if(!exact(item,['neighbor','edge'])||!topologyCount(item.neighbor)||item.neighbor>=source.vertexCount||!topologyCount(item.edge)||item.edge>=source.edgeCount)fail();yield item;}}
 let total=0,selection;
 if(operation.kind==='neighbors'){
  selection='neighbor:';for await(const link of links(start)){if(!await add('neighbor-edge:'+link.edge,true))continue;const id=selection+link.neighbor,prior=await get(id);if(prior===undefined){await put(id,{multiplicity:1});total=increment(total);}else await put(id,{multiplicity:increment(prior.multiplicity)});}
 }else{
  const target=operation.kind==='reachable'?await lookup(operation.to):null;selection='visited:';let head=0,tail=1;await add(selection+start.index,true);await put('queue:0',start.index);total=1;
  if(target?.index===start.index){await current();return {kind:'reachable',value:true,direction:operation.direction,source:{operand:0,from:start.index,to:target.index}};}
  while(head<tail){const index=await get('queue:'+head);head=increment(head);if(!topologyCount(index)||index>=source.vertexCount)fail();const value=await vertex(index);for await(const link of links(value))if(await add(selection+link.neighbor,true)){await put('queue:'+tail,link.neighbor);tail=increment(tail);total=increment(total);}
   if(progress&&head%32===0)await io(()=>progress({phase:'traversal',done:head,total:tail}));
  }
  if(target){const result={kind:'reachable',value:(await get(selection+target.index))===true,direction:operation.direction,source:{operand:0,from:start.index,to:target.index}};await current();return result;}
 }
 if(stream){let count=0;for(let index=0;index<source.vertexCount;index++){const selected=await get(selection+index);if(selected===undefined)continue;const value=await vertex(index);yield {index:count++,spelling:value.key,source:{operand:0,vertex:index},...(operation.kind==='neighbors'?{multiplicity:scalar(selected.multiplicity)}:{})};await current();}if(count!==total)fail();return {kind:'sequence',definition:topologyVertexSequenceDefinition(source.definition),unit:'',unitDefinition:null,count:total,complete:true,source:sourceRef};}
 if(operation.offset>total)fail('MEASUREMENT_TOPOLOGY_INDEX');const items=[];let ordinal=0;
 for(let index=0;index<source.vertexCount&&items.length<operation.limit;index++){const selected=await get(selection+index);if(selected===undefined)continue;if(ordinal++<operation.offset)continue;const value=await vertex(index);items.push({index:ordinal-1,spelling:value.key,source:{operand:0,vertex:index},...(operation.kind==='neighbors'?{multiplicity:scalar(selected.multiplicity)}:{})});}
 const result={kind:'sequence-page',definition:topologyVertexSequenceDefinition(source.definition),unit:'',unitDefinition:null,items,offset:operation.offset,total,next:operation.offset+items.length<total?operation.offset+items.length:null,complete:true,source:sourceRef};await current();return result;
}

export async function evaluateTopology(operation,source,options={}){const iterator=topologyExecution(operation,source,{...options,stream:false});try{const result=await iterator.next();if(!result.done)fail();return result.value;}finally{await iterator.return();}}
export async function* iterateTopologyVertices(operation,source,options={}){return yield* topologyExecution(operation,source,{...options,stream:true});}
