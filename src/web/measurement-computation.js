import messages from './locales/en/measurements.json' with {type:'json'};
import {validMaterialReference} from './material-reference.js';
const keys=(value,list)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===list.length&&list.every(key=>Object.hasOwn(value,key));
// Numerical identity describes stored digits. Computation provenance separately
// records that these digits, or inputs used to derive them, are approximate.
export function validComputation(value){
 if(value?.version!==1)return false;
 if(value.kind==='approximate-inputs')return keys(value,['version','kind']);
 return value.kind==='approximate'&&keys(value,['version','kind','recipe'])&&validMaterialReference(value.recipe)&&value.recipe.kind==='analysis';
}
export const hasApproximateComputation=value=>validComputation(value?.computation??value);
export const derivedComputation=(...values)=>values.some(hasApproximateComputation)?{computation:{version:1,kind:'approximate-inputs'}}:{};
export function computationLabel(value){const computation=value?.computation??value;return validComputation(computation)?computation.kind==='approximate'?messages.computationApproximate:messages.computationApproximateInputs:'';}
