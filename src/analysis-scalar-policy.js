import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {measurementScalarPolicies,resolveScalarDefinitions,resolveScalarOperand} from './measurement-scalar-storage.js';
import {graphScalarCell} from './dataset-resource-values.js';
import {isScalarRepresentation} from './web/measurement-model.js';
import {isScalarResourceFailure,scalarTextReference} from './web/measurement-scalar-policy.js';
import {selectedDatasetColumns,assertDatasetScalars} from './dataset-selected-columns.js';

export const comparisonBudget=comparison=>comparison.version===3?new DatasetResourceBudget(comparison.resourcePolicy):null;
export function comparisonOperation(budget,operation){
 try{return budget?budget.run(operation):operation();}
 catch(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;throw new AppError('ANALYSIS_MAPPING');}
}
export async function comparisonColumns(inputs,doc,indices,comparison,{signal}={}){
 const selected=await selectedDatasetColumns(inputs,doc,indices);
 if(comparison.version!==3){if(selected.columns.some(measurementScalarPolicies))throw new AppError('ANALYSIS_SCALAR_POLICY');return selected;}
 // Admission validates every selected interpretation even for empty datasets.
 // Foreign declaration text is read only inside its authenticated source scope.
 for(const [index,column] of selected.columns.entries()){const options={signal,budget:comparisonBudget(comparison)};selected.columns[index]=inputs.comparisonColumn?await inputs.comparisonColumn(doc,column,options):await resolveScalarDefinitions(inputs,column,options);}
 return selected;
}
export async function resolveComparisonRow(materials,row,columns,comparison,{signal,budget}={}){
 if(comparison.version!==3){if(columns.some(measurementScalarPolicies))throw new AppError('ANALYSIS_SCALAR_POLICY');assertDatasetScalars(row);return {row,columns};}
 const resolved={...row,cells:[]},definitions=[];
 for(const [index,column] of columns.entries()){
  signal?.throwIfAborted();const definition=await resolveScalarDefinitions(materials,column,{signal,budget});definitions.push(definition);
  const cell={kind:row.valueKinds?.[index]??'string',value:row.cells[index]};
  let value;
  try{
   if(isScalarRepresentation(definition))value=await resolveScalarOperand(materials,cell,definition,{signal,budget,policy:comparison.resourcePolicy});
   else value=await graphScalarCell(materials,cell,comparison.resourcePolicy,{signal});
  }catch(error){comparisonOperation(null,()=>{throw error;});}
  if(typeof value.value!=='string')throw new AppError('DATASET_CELL_SCALAR_REQUIRED');
  if(value.value.length>comparison.resourcePolicy.resources.maxScalarCharacters)throw new AppError('DATASET_CALCULATION_RESOURCE');
  if(typeof cell.value!=='string'){
   if(!scalarTextReference(cell.value)||createHash('sha256').update(value.value,'utf16le').digest('hex')!==cell.value.sha256)throw new AppError('MATERIAL_MISSING');
  }
  resolved.cells.push(value.value);
 }
 signal?.throwIfAborted();return {row:resolved,columns:definitions};
}
export async function comparisonRow(inputs,doc,row,columns,comparison,options={}){
 if(comparison.version!==3)return resolveComparisonRow(inputs,row,columns,comparison,options);
 return inputs.comparisonRow?inputs.comparisonRow(doc,row,columns,comparison,options):resolveComparisonRow(inputs,row,columns,comparison,options);
}
