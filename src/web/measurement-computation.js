import {modelMessages} from './model-messages.js';
import messages from './locales/en/measurements.json' with {type:'json'};
import {validMaterialReference} from './material-reference.js';
import {validCalculationPolicy} from './tools/calculation-policy.js';
const keys=(value,list)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===list.length&&list.every(key=>Object.hasOwn(value,key));
const descriptor=value=>value&&Object.hasOwn(value,'computation')?value.computation:value;
export class CellComputationError extends Error{constructor(){super('Read the computation attached to the selected value before using this column.');this.code='DATASET_CELL_COMPUTATION';}}
// A per-cell column declares an interpretation, not that all its values are
// approximate. Each current cell explicitly stores null for an exact result.
export const perCellComputation=value=>keys(descriptor(value),['version','kind'])&&descriptor(value).version===2&&descriptor(value).kind==='per-cell';
export function validComputation(value){
 if(value?.version===2)return perCellComputation(value)||value.kind==='approximate'&&keys(value,['version','kind','method','engine','policy'])&&value.method==='pearson-centered-pairs-v1'&&value.engine===4&&value.policy?.version===2&&validCalculationPolicy(value.policy);
 if(value?.version!==1)return false;
 if(value.kind==='approximate-inputs')return keys(value,['version','kind']);
 return value.kind==='approximate'&&keys(value,['version','kind','recipe'])&&validMaterialReference(value.recipe)&&value.recipe.kind==='analysis';
}
export const validCellComputation=value=>value===null||validComputation(value)&&!perCellComputation(value);
export const hasApproximateComputation=value=>validComputation(descriptor(value))&&!perCellComputation(value);
export function resolveCellComputation(column,cell){
 if(perCellComputation(column)){if(!cell||!Object.hasOwn(cell,'computation')||!validCellComputation(cell.computation))throw new CellComputationError();return cell.computation;}
 if(cell&&Object.hasOwn(cell,'computation')&&!validCellComputation(cell.computation))throw new CellComputationError();
 return cell?.computation??column?.computation??null;
}
export function effectiveCellColumn(column,cell){const actual=resolveCellComputation(column,cell),result={...column};if(actual===null)delete result.computation;else result.computation=actual;return result;}
export function derivedComputation(...values){if(values.some(perCellComputation))throw new CellComputationError();return values.some(hasApproximateComputation)?{computation:{version:1,kind:'approximate-inputs'}}:{};}
export const derivedColumnComputation=(...values)=>values.some(perCellComputation)?{computation:{version:2,kind:'per-cell'}}:derivedComputation(...values);
export function derivedCellComputation(...cells){if(cells.some(cell=>Object.hasOwn(cell??{},'computation')&&!validCellComputation(cell.computation)))throw new CellComputationError();return {computation:cells.some(hasApproximateComputation)?{version:1,kind:'approximate-inputs'}:null};}
export function computationLabel(value,{translate}={}){const text=modelMessages('measurements',messages,translate),computation=descriptor(value);return validComputation(computation)?perCellComputation(computation)?text('computationPerCell'):computation.version===2?text('computationApproximateMethod'):computation.kind==='approximate'?text('computationApproximate'):text('computationApproximateInputs'):'';}

export function cellComputationLabel(column,cell){const actual=resolveCellComputation(column,cell);return actual===null?perCellComputation(column)?messages.computationExact:'':computationLabel(actual);}
