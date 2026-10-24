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
  if(!source||node.component?.length!==1||!Number.isSafeInteger(node.component[0])||node.component[0]<0||node.component[0]>=columns[0].domain.shape[0])fail();const result={...column};delete result.coordinateFrame;return result;
 }
 fail();
}
export function assertCoordinateFrameGraphVersion(column,graphVersion){if(column?.coordinateFrame!==undefined&&(graphVersion<13||!validCoordinateFrameDescriptor(column.coordinateFrame)))fail();return column;}
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
