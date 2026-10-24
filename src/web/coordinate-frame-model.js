// A frame binds an explicit ordered axis set to a namespace and homogeneous
// difference unit. Neither axis labels nor a matrix imply physical meaning.
import {validMaterialReference} from './material-reference.js';
import {validLocator} from './measurement-model.js';
import {researchId} from './research-reference.js';
import {validUnitDefinition} from './measurement-unit-model.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
export const COORDINATE_FRAME_TOOL='Observanda coordinate frame';
export const COORDINATE_FRAME_TRANSFORM_TOOL='Observanda coordinate frame transform';
export const COORDINATE_FRAME_METHOD='affine-frame-transform-v1';
export class CoordinateFrameError extends Error{constructor(code='COORDINATE_FRAME_INVALID'){super(code);this.code=code;}}
const keys=(value,required,optional=[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/u.test(value);
const prose=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const reference=value=>validMaterialReference(value)&&value.kind==='analysis';
export const coordinateFrameCell=value=>validLocator(value)&&value.ref.kind==='dataset'&&value.selector.kind==='cell';
export function validCoordinateFrameAxes(value){
 const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),root=value?.root;
 return keys(value,['format','kind','root','count','chunkSize'])&&value.format===1&&value.kind==='coordinate-frame-axes'&&Number.isSafeInteger(value.count)&&value.count>=0&&value.chunkSize===1&&(root===null?value.count===0:keys(root,['count','hash','height','key'])&&hash(root.hash)&&hash(root.key)&&positive(root.height)&&root.height<=76&&Number.isSafeInteger(root.count)&&root.count>=root.height&&root.count===value.count);
}
export function validCoordinateFrameAxis(value){return keys(value,['id','name'])&&researchId(value.id)&&text(value.name,200)&&!!value.name.trim();}
export function validCoordinateFrame(value,{complete=true}={}){
 return keys(value,['version','namespace','dimension','axesIndex','unit','unitDefinition','rationale','resourcePolicy'],['tool','inputsIndex'])&&value.version===1&&(value.tool===undefined||value.tool===COORDINATE_FRAME_TOOL)&&text(value.namespace,200)&&!!value.namespace.trim()&&positive(value.dimension)&&Number.isSafeInteger(value.dimension*value.dimension)&&validCoordinateFrameAxes(value.axesIndex)&&(complete?value.axesIndex.count===value.dimension:value.axesIndex.count<=value.dimension)&&text(value.unit,100)&&validUnitDefinition(value.unitDefinition)&&value.unitDefinition.kind==='difference'&&prose(value.rationale,10000)&&!!value.rationale.trim()&&validDatasetResourcePolicy(value.resourcePolicy);
}
export function validCoordinateFrameTransform(value){
 return keys(value,['version','method','sourceFrame','targetFrame','matrix','offset','rationale','resourcePolicy'],['tool','inputsIndex'])&&value.version===1&&value.method===COORDINATE_FRAME_METHOD&&(value.tool===undefined||value.tool===COORDINATE_FRAME_TRANSFORM_TOOL)&&reference(value.sourceFrame)&&reference(value.targetFrame)&&coordinateFrameCell(value.matrix)&&coordinateFrameCell(value.offset)&&prose(value.rationale,10000)&&!!value.rationale.trim()&&validDatasetResourcePolicy(value.resourcePolicy);
}
export function validCoordinateFrameDescriptor(value){
 return keys(value,['version','frame'],['sourceFrame','transform','axesIndex'])&&value.version===1&&reference(value.frame)&&(value.axesIndex===undefined||validCoordinateFrameAxes(value.axesIndex))&&(value.sourceFrame===undefined&&value.transform===undefined||reference(value.sourceFrame)&&reference(value.transform));
}
