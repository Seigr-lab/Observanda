import {validMaterialReference} from './material-reference.js';
import {validCellComputation} from './measurement-computation.js';
import {researchId} from './research-reference.js';
import {validPolicyScalar} from './measurement-scalar-policy.js';
import {validUnitDefinition} from './measurement-unit-model.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';

export const COORDINATE_ALIGNMENT_METHOD='coordinate-neighbor-v1';
export const COORDINATE_ALIGNMENT_DIRECTIONS=Object.freeze(['backward','forward','nearest']);
export const COORDINATE_ALIGNMENT_TIES=Object.freeze(['first-source','last-source','error']);
export const isCoordinateAlignment=match=>match?.method===COORDINATE_ALIGNMENT_METHOD;
const exact=(value,names)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const position=value=>Number.isSafeInteger(value)&&value>=0;
// Coordinates retain their source declarations. Units, source ancestry and
// tolerance sign are checked against the pinned graph during compilation.
export function validCoordinateAlignment(value,policy){
 return Boolean(validDatasetResourcePolicy(policy)&&exact(value,['left','right','direction','tolerance','toleranceUnit','ties','missing','excluded'])&&
  exact(value.left,['id','position'])&&researchId(value.left.id)&&position(value.left.position)&&position(value.right)&&
  COORDINATE_ALIGNMENT_DIRECTIONS.includes(value.direction)&&COORDINATE_ALIGNMENT_TIES.includes(value.ties)&&
  validPolicyScalar(value.tolerance,policy)&&validUnitDefinition(value.toleranceUnit)&&value.toleranceUnit.kind==='difference'&&
  ['error','skip'].includes(value.missing)&&value.excluded==='skip');
}

const indexKinds=Object.freeze(['coordinate-alignment-contexts','coordinate-alignment-decisions','coordinate-alignment-evidence']);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function validCoordinateAlignmentIndex(value,kind){
 if(!indexKinds.includes(kind)||!exact(value,['format','kind','root','count','chunkSize'])||value.format!==1||value.kind!==kind||!position(value.count)||value.chunkSize!==1)return false;
 const root=value.root;return root===null?value.count===0:exact(root,['count','hash','height','key'])&&hash(root.hash)&&hash(root.key)&&Number.isSafeInteger(root.height)&&root.height>0&&root.height<=76&&Number.isSafeInteger(root.count)&&root.count>=root.height&&root.count===value.count;
}
const address=value=>exact(value,['id','position'])&&researchId(value.id)&&position(value.position);
export function validCoordinateAlignmentContext(value){
 return Boolean(exact(value,['version','method','graph','binding','direction','tolerance','toleranceUnit','ties','missing','excluded','unmatched','partitionKeys','resourcePolicy'])&&value.version===1&&value.method===COORDINATE_ALIGNMENT_METHOD&&validMaterialReference(value.graph)&&value.graph.kind==='analysis'&&address(value.binding)&&position(value.partitionKeys)&&['error','keep'].includes(value.unmatched)&&validCoordinateAlignment({left:value.binding,right:0,direction:value.direction,tolerance:value.tolerance,toleranceUnit:value.toleranceUnit,ties:value.ties,missing:value.missing,excluded:value.excluded},value.resourcePolicy));
}
export function validCoordinateAlignmentReceipt(value,policy){
 if(!validDatasetResourcePolicy(policy)||!exact(value,['version','status','delta','tieCount','decisionComputation','evidenceIndex'])||value.version!==1||!['matched','left-missing','no-candidate','outside-tolerance'].includes(value.status)||!position(value.tieCount)||!validCellComputation(value.decisionComputation)||!validCoordinateAlignmentIndex(value.evidenceIndex,'coordinate-alignment-evidence')||value.evidenceIndex.count>4)return false;
 return Boolean(['matched','outside-tolerance'].includes(value.status)?value.tieCount>0&&validPolicyScalar(value.delta,policy)&&value.evidenceIndex.count>0:value.delta===null&&value.tieCount===0);
}
export const validCoordinateAlignmentColumn=value=>exact(value,['version','contextsIndex'])&&value.version===1&&validCoordinateAlignmentIndex(value.contextsIndex,'coordinate-alignment-contexts');
export const validCoordinateAlignmentCell=value=>exact(value,['version','decisionsIndex'])&&value.version===1&&validCoordinateAlignmentIndex(value.decisionsIndex,'coordinate-alignment-decisions');
export const validCoordinateAlignmentMeasurement=value=>exact(value,['version','contextsIndex','decisionsIndex'])&&value.version===1&&validCoordinateAlignmentIndex(value.contextsIndex,'coordinate-alignment-contexts')&&validCoordinateAlignmentIndex(value.decisionsIndex,'coordinate-alignment-decisions');

export const validCoordinateAlignmentAxis=value=>exact(value,['version','frame','axis'])&&value.version===1&&validMaterialReference(value.frame)&&value.frame.kind==='analysis'&&position(value.axis);
