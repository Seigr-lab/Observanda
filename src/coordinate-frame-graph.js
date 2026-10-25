import {CoordinateAlignmentError} from './coordinate-alignment-kernel.js';
import {validCoordinateAlignmentAxis} from './web/coordinate-alignment-model.js';
import {DatasetResourceBudget} from './dataset-resource-budget.js';
// Shared compiler guards prevent an ordinary graph operation from erasing a
// frame revision or changing its ordered axes implicitly.
import {CoordinateFrameError,COORDINATE_FRAME_METHOD,COORDINATE_FRAME_TRANSFORM_TOOL,validCoordinateFrameDescriptor,validCoordinateFrame,validCoordinateFrameAxis,COORDINATE_FRAME_TOOL,coordinateFrameCell} from './web/coordinate-frame-model.js';
import {validGraphAddress} from './web/dataset-calculation-graph-model.js';
import {materialReferenceKey,validMaterialReference} from './web/material-reference.js';
import {revisionText} from './web/revision-model.js';
import {verifyCoordinateFrameTransform,coordinateFrameTransformColumn,calculateCoordinateFrameTransformNode} from './coordinate-frame-transform.js';
const fail=()=>{throw new CoordinateFrameError('COORDINATE_FRAME_INCOMPATIBLE');};
const same=(a,b)=>!!a&&!!b&&materialReferenceKey(a.frame)===materialReferenceKey(b.frame);
const reference=value=>validMaterialReference(value)&&value.kind==='analysis';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===names.sort().join();
export function coordinateFrameGraphColumn(node,columns,column,{graphVersion=13}={}){
 const axes=columns.filter(value=>value?.coordinateAxis);if(axes.length){if(graphVersion<17||axes.some(value=>!validCoordinateAlignmentAxis(value.coordinateAxis)))fail();const source=columns[0]?.coordinateAxis,sameAxis=source&&revisionText(source)===revisionText(columns[1]?.coordinateAxis);if(node.kind==='scalar'&&node.operation==='copy')return {...column,coordinateAxis:structuredClone(source)};if(node.kind==='scalar'&&node.operation==='choose'&&sameAxis)return {...column,coordinateAxis:structuredClone(source)};if(node.kind==='comparison'&&!sameAxis)fail();const result={...column};delete result.coordinateAxis;column=result;}
 const framed=columns.filter(value=>value?.coordinateFrame!==undefined);if(!framed.length)return column;
 if(graphVersion<13||framed.some(value=>!validCoordinateFrameDescriptor(value.coordinateFrame)))fail();
 if(node.kind==='coordinate-transform')return column;
 const source=columns[0]?.coordinateFrame,matched=source&&same(source,columns[1]?.coordinateFrame);
 if(node.kind==='domain'&&node.operation==='copy')return {...column,coordinateFrame:structuredClone(source)};
 if(node.kind==='domain'&&node.operation==='choose'||node.kind==='domain-arithmetic'&&['add','subtract'].includes(node.operation)){
  if(!matched)fail();return {...column,coordinateFrame:structuredClone(source)};
 }
 if(node.kind==='comparison'){if(!matched)fail();return column;}
 if(node.kind==='domain'&&node.operation==='extract'){
  if(!source||node.component?.length!==1||!Number.isSafeInteger(node.component[0])||node.component[0]<0||node.component[0]>=columns[0].domain.shape[0])fail();const result={...column};delete result.coordinateFrame;if(graphVersion>=17)result.coordinateAxis={version:1,frame:structuredClone(source.frame),axis:node.component[0]};return result;
 }
 fail();
}
export function assertCoordinateFrameGraphVersion(column,graphVersion){if(column?.coordinateAxis!==undefined&&(graphVersion<17||!validCoordinateAlignmentAxis(column.coordinateAxis)))fail();if(column?.coordinateFrame!==undefined&&(graphVersion<13||!validCoordinateFrameDescriptor(column.coordinateFrame)))fail();return column;}
export function assertCoordinateFrameComparison(left,right,{graphVersion=13}={}){coordinateFrameGraphColumn({kind:'comparison'},[left,right],null,{graphVersion});}
export async function compileCoordinateFrameNode(materials,node,column,{work,policy,budget,signal,check}={}){
 signal?.throwIfAborted();await check?.();const model=await materials.read(node.model);if(model.kind!=='analysis'||model.content.tool!==COORDINATE_FRAME_TRANSFORM_TOOL)fail();await materials.assertOwner?.(model.recordId);
 const operation=budget??new DatasetResourceBudget(policy??model.content.resourcePolicy),verified=await verifyCoordinateFrameTransform(materials,model.content,{model:node.model,work,policy,budget:operation,signal,check});return {column:coordinateFrameTransformColumn(node,column,verified,{policy,budget:operation}),coordinateTransform:verified};
}
export function evaluateCoordinateFrameNode(materials,node,cell,column,options={}){return calculateCoordinateFrameTransformNode(materials,node,cell,column,options);}
export function coordinateTransformLineage(node,position,context){return {version:1,method:COORDINATE_FRAME_METHOD,node:{id:node.id,position},model:structuredClone(node.model),sourceFrame:structuredClone(context.content.sourceFrame),targetFrame:structuredClone(context.content.targetFrame),matrix:structuredClone(context.content.matrix),offset:structuredClone(context.content.offset)};}
export function validCoordinateTransformLineage(value){return keys(value,['version','method','node','model','sourceFrame','targetFrame','matrix','offset'])&&value.version===1&&value.method===COORDINATE_FRAME_METHOD&&validGraphAddress(value.node)&&reference(value.model)&&reference(value.sourceFrame)&&reference(value.targetFrame)&&coordinateFrameCell(value.matrix)&&coordinateFrameCell(value.offset);}
export function coordinateComponentLineage(node,position,column){return {version:1,node:{id:node.id,position},frame:structuredClone(column.coordinateFrame.frame),axis:node.component[0]};}
export function validCoordinateComponentLineage(value){return keys(value,['version','node','frame','axis'])&&value.version===1&&validGraphAddress(value.node)&&reference(value.frame)&&Number.isSafeInteger(value.axis)&&value.axis>=0;}
export async function appendCoordinateFrameLineage(leaves,source,field,value,{signal,check}={}){
 if(field==='coordinateTransform'?!validCoordinateTransformLineage(value):field==='coordinateComponent'?!validCoordinateComponentLineage(value):true)fail();let result=source;
 for(let offset=0;offset<source.count;){signal?.throwIfAborted();await check?.();const page=await leaves.page(source,{offset,limit:16});for(const leaf of page.items){signal?.throwIfAborted();const annotated={binding:leaf.binding,column:leaf.column,[field]:value};result=await leaves.union(result,await leaves.leaf(annotated));}if(page.next===null)break;offset=page.next;}
 return result;
}
export async function verifyCoordinateTransformLineage(materials,value,node,{signal,check}={}){
 if(!validCoordinateTransformLineage(value)||node.kind!=='coordinate-transform'||revisionText(node.model)!==revisionText(value.model))fail();signal?.throwIfAborted();await check?.();const model=await materials.read(value.model);await materials.assertOwner?.(model.recordId);if(model.content?.tool!==COORDINATE_FRAME_TRANSFORM_TOOL)fail();for(const key of ['sourceFrame','targetFrame','matrix','offset'])if(revisionText(model.content[key])!==revisionText(value[key]))fail();for(const ref of [value.sourceFrame,value.targetFrame,value.matrix.ref,value.offset.ref]){signal?.throwIfAborted();await check?.();const doc=await materials.read(ref);await materials.assertOwner?.(doc.recordId);}return {coordinateTransform:value,sources:[{ref:value.model,selector:{kind:'whole'}},value.matrix,value.offset,{ref:value.sourceFrame,selector:{kind:'whole'}},{ref:value.targetFrame,selector:{kind:'whole'}}]};
}

// Resolve the declared frame through only earlier frame-preserving graph nodes.
// This inspector path reads declarations, never the matrix or computed values.
export async function verifyCoordinateComponentLineage(materials,value,graphs,content,{column,signal,check}={}){
 if(!validCoordinateComponentLineage(value))fail();const extraction=await graphs.at(content,'nodes',value.node);if(extraction.kind!=='domain'||extraction.operation!=='extract'||extraction.component.length!==1||extraction.component[0]!==value.axis)fail();let address=extraction.left,frame;
 for(;;){signal?.throwIfAborted();await check?.();const node=await graphs.at(content,'nodes',address);
  if(node.kind==='column'){const binding=await graphs.at(content,'bindings',node.binding),source=await column(binding,node.column);if(!validCoordinateFrameDescriptor(source.coordinateFrame))fail();frame=source.coordinateFrame.frame;break;}
  if(node.kind==='coordinate-transform'){const model=await materials.read(node.model);await materials.assertOwner?.(model.recordId);if(model.content?.tool!==COORDINATE_FRAME_TRANSFORM_TOOL)fail();frame=model.content.targetFrame;break;}
  if(!(node.kind==='domain'&&['copy','choose'].includes(node.operation)||node.kind==='domain-arithmetic'&&['add','subtract'].includes(node.operation))||!validGraphAddress(node.left)||node.left.position>=address.position)fail();address=node.left;
 }
 if(materialReferenceKey(frame)!==materialReferenceKey(value.frame))fail();const document=await materials.read(frame);await materials.assertOwner?.(document.recordId);if(document.content?.tool!==COORDINATE_FRAME_TOOL||!validCoordinateFrame(document.content)||value.axis>=document.content.dimension)fail();const axis=await materials.sequences.item(document.content.axesIndex,value.axis);if(!validCoordinateFrameAxis(axis))fail();signal?.throwIfAborted();await check?.();return {coordinateComponent:{...value,axisDeclaration:axis},sources:[{ref:frame,selector:{kind:'whole'}}]};
}

// Earlier graphs retained component lineage but had no scalar-axis descriptor.
// Resolve only the selected output and explicit copy/frame-preserving paths.
export async function historicalCoordinateAxis(materials,source,index,column,{signal,work}={}){
 signal?.throwIfAborted();if(column.coordinateAxis||source.kind!=='dataset')return column;const sourceDoc=await materials.read(source),recipe=sourceDoc.content.calculation;if(!recipe?.graph||recipe.version<16||recipe.version>=20)return column;
 if(!work){const {withScratch}=await import('./scratch-work.js');return withScratch(work=>historicalCoordinateAxis(materials,source,index,column,{signal,work}),{signal});}
 const {CalculationGraphs}=await import('./calculation-graphs.js'),{DatasetCalculations}=await import('./dataset-calculations.js'),graphs=new CalculationGraphs(materials),datasets=new DatasetCalculations(materials),prefix='historical-coordinate-axis:',stackPrefix=prefix+'stack:';let depth=0;
 const key=task=>prefix+(task.kind==='column'?'column:'+materialReferenceKey(task.source)+':'+task.index+':'+task.view:'node:'+materialReferenceKey(task.graph)+':'+task.address.position+':'+task.address.id);
 const selected=async(binding,index)=>(await datasets.schema(binding.source,binding.view,{columns:[index],version:3}))[0];
 const nodeTask=(graph,address)=>({kind:'node',graph,address});
 const extractedAxis=async(node,address,graph)=>{let input=node.left,remaining=graph.content.graphNodesIndex.count+1,frame;for(;;){signal?.throwIfAborted();if(--remaining<0)fail();const value=await graphs.at(graph.content,'nodes',input);if(value.kind==='column'){const binding=await graphs.at(graph.content,'bindings',value.binding);frame=(await selected(binding,value.column)).coordinateFrame?.frame;break;}if(value.kind==='coordinate-transform'){const transform=await materials.read(value.model);if(transform.content?.tool!==COORDINATE_FRAME_TRANSFORM_TOOL)fail();frame=transform.content.targetFrame;break;}if(!(value.kind==='domain'&&['copy','choose'].includes(value.operation)||value.kind==='domain-arithmetic'&&['add','subtract'].includes(value.operation)))return null;if(!validGraphAddress(value.left)||value.left.position>=input.position)fail();input=value.left;}if(!frame)return null;const axis={version:1,frame,axis:node.component[0]};await verifyCoordinateComponentLineage(materials,{...axis,node:address},graphs,graph.content,{signal,column:selected});return axis;};
 await work.put(stackPrefix+0,{task:{kind:'column',source,index,view:'observations'}});
 try{while(depth>=0){signal?.throwIfAborted();const current=await work.get(stackPrefix+depth);if(!current)fail();const identity=key(current.task),cached=await work.get(identity);if(cached){await work.remove(stackPrefix+depth);await work.remove(identity+':active');depth--;if(depth<0)return cached.axis?{...column,coordinateAxis:cached.axis}:column;continue;}
   if(!current.dependencies){await work.put(identity+':active',true);const task=current.task;let axis=null,dependencies=null;
    if(task.kind==='column'){const declared=await selected({source:task.source,view:task.view},task.index);if(declared.coordinateAxis)axis=declared.coordinateAxis;else if(task.source.kind==='dataset'){const doc=await materials.read(task.source),calculation=doc.content.calculation;if(calculation?.graph&&calculation.version>=16&&calculation.version<20){const graph=await graphs.read(calculation.graph),output=await materials.sequences.item(graph.content.graphOutputsIndex,task.index);dependencies=[nodeTask(calculation.graph,output.node)];}}}
    else{const graph=await graphs.read(task.graph),node=await graphs.at(graph.content,'nodes',task.address);if(node.kind==='column'){const binding=await graphs.at(graph.content,'bindings',node.binding);dependencies=[{kind:'column',source:binding.source,index:node.column,view:binding.view}];}else if(node.kind==='scalar'&&['copy','choose'].includes(node.operation)){const addresses=node.operation==='choose'?[node.left,node.right]:[node.left];if(addresses.some(address=>!validGraphAddress(address)||address.position>=task.address.position))fail();dependencies=addresses.map(address=>nodeTask(task.graph,address));}else if(node.kind==='domain'&&node.operation==='extract')axis=await extractedAxis(node,task.address,graph);}
    if(!dependencies){await work.put(identity,{axis});continue;}current.dependencies=dependencies;await work.put(stackPrefix+depth,current);
   }
   let pending=null,axis,assigned=false;for(const dependency of current.dependencies){const result=await work.get(key(dependency));if(!result){pending=dependency;break;}if(assigned&&revisionText(axis)!==revisionText(result.axis))throw new CoordinateAlignmentError('DATASET_ALIGNMENT_CONTEXT');axis=result.axis;assigned=true;}
   if(pending){if(await work.get(key(pending)+':active'))fail();depth++;if(!Number.isSafeInteger(depth))fail();await work.put(stackPrefix+depth,{task:pending});}else await work.put(identity,{axis});
  }
 }finally{while(depth>=0){const current=await work.get(stackPrefix+depth);if(current)await work.remove(key(current.task)+':active');await work.remove(stackPrefix+depth);depth--;}}
 fail();
}
