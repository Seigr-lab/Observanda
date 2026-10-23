import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {validPolicyScalar,validatePolicyScalar} from './measurement-scalar-policy.js';
// Closed bounds and authored coverage are separate from statistical inference.
import {validNumeralContext} from './numeral-context.js';
import {validMaterialReference} from './material-reference.js';
import {unitScalar} from './measurement-unit-model.js';
const exact=(value,names)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key));
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
export const INTERVAL_CODEC='observanda.interval';
export const INTERVAL_ALGORITHM='observanda-rational-interval-enclosure';
export const INTERVAL_OPERATIONS=Object.freeze(['bounds','lower','upper','add','subtract','multiply','divide']);
export const INTERVAL_COVERAGE_KINDS=Object.freeze(['confidence','probability']);
export const intervalDomain=(component={version:1,representation:'decimal',radix:10})=>({version:1,codec:INTERVAL_CODEC,codecVersion:1,namespace:'',shape:[2],component:{...component}});
export function validIntervalDomain(value){
 return exact(value,['version','codec','codecVersion','namespace','shape','component',...(value?.version===2?['resourcePolicy']:[])])&&[1,2].includes(value.version)&&(value.version!==2||validDatasetResourcePolicy(value.resourcePolicy))&&value.codec===INTERVAL_CODEC&&value.codecVersion===1&&text(value.namespace,200)&&Array.isArray(value.shape)&&value.shape.length===1&&value.shape[0]===2&&validNumeralContext(value.component);
}
function reference(value){
 return value===null||validMaterialReference(value)&&Object.keys(value).every(key=>['kind','id','revision','workspaceId','label'].includes(key))&&(value.label===undefined||text(value.label,300));
}
export function validIntervalCoverage(value,policy){
 if(value===null)return true;
 if(!exact(value,['kind','level'])||!INTERVAL_COVERAGE_KINDS.includes(value.kind))return false;
 if(policy)return validPolicyScalar(value.level,policy);
 try{const level=unitScalar(value.level);return level.numerator>=0n&&level.numerator<=level.denominator;}catch{return false;}
}
export const blankIntervalUncertainty=()=>({version:1,kind:'declared-interval',method:{name:'',version:'',reference:null},coverage:null});
export const enclosureUncertainty=()=>({version:1,kind:'derived-enclosure',method:{name:INTERVAL_ALGORITHM,version:'1',reference:null},coverage:null});
export function validIntervalUncertainty(value){
 if(!exact(value,['version','kind','method','coverage',...(value?.version===2?['resourcePolicy']:[])])||![1,2].includes(value.version)||value.version===2&&!validDatasetResourcePolicy(value.resourcePolicy)||!['declared-interval','derived-enclosure'].includes(value.kind)||!exact(value.method,['name','version','reference'])||!text(value.method.name,300)||!value.method.name.trim()||!text(value.method.version,100)||!reference(value.method.reference)||!validIntervalCoverage(value.coverage,value.resourcePolicy))return false;
 return value.kind!=='derived-enclosure'||value.coverage===null&&value.method.name===INTERVAL_ALGORITHM&&value.method.version==='1'&&value.method.reference===null;
}
export function intervalReferences(value){
 if(!validIntervalUncertainty(value))throw Error('Declare the interval method and valid coverage metadata.');
 return value.method.reference?[value.method.reference]:[];
}

export function validateIntervalUncertainty(value,{budget}={}){if(!validIntervalUncertainty(value))throw RangeError('Declare valid interval uncertainty');if(value.version===2&&value.coverage){const level=validatePolicyScalar(value.coverage.level,value.resourcePolicy,{budget});if(level.numerator<0n||level.numerator>level.denominator)throw RangeError('Coverage must lie between zero and one');}return value;}
