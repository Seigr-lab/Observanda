import {AppError} from './errors.js';
import {graphScalarCell} from './dataset-resource-values.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {validateMeasurementProjection} from './web/measurement-transform.js';
import {revisionText} from './web/revision-model.js';
export const retainedPlotVersion=version=>['9','10'].includes(version);
export function assertPlotResourcePolicy(mapping,{version}={}){
 if(version==='10'&&!validDatasetResourcePolicy(mapping?.resourcePolicy)||version&&version!=='10'&&mapping?.resourcePolicy!==undefined)throw new AppError('MATERIAL_INVALID');
 if(mapping?.resourcePolicy!==undefined&&!validDatasetResourcePolicy(mapping.resourcePolicy))throw new AppError('MATERIAL_INVALID');
 if(mapping?.projection){try{validateMeasurementProjection(mapping.projection);}catch(error){plotComputationFailure(error,'MATERIAL_INVALID');}
 if(mapping.resourcePolicy?(mapping.projection.version!==2||revisionText(mapping.resourcePolicy)!==revisionText(mapping.projection.resourcePolicy)):mapping.projection.version!==1)throw new AppError('MATERIAL_INVALID');}
}
export function plotComputationFailure(error,code='MATERIAL_PRECISION'){
 if(error?.code==='DATASET_CALCULATION_RESOURCE')throw error instanceof AppError?error:new AppError('DATASET_CALCULATION_RESOURCE');
 if(error?.name==='AbortError'||['JOB_CANCELLED','ACCESS_LOCKED','WORKSPACE_CHANGED'].includes(error?.code))throw error;
 throw new AppError(code);
}
export function plotOperation(mapping,fn){return mapping.resourcePolicy?numericalOperation(new DatasetResourceBudget(mapping.resourcePolicy),fn):fn();}
export async function plotScalarValue(materials,value,mapping,{signal}={}){
 signal?.throwIfAborted();if(typeof value==='string')return value;
 if(!mapping.resourcePolicy)throw new AppError('DATASET_CELL_SCALAR_REQUIRED');
 const cell=await graphScalarCell(materials,{value,kind:'string'},mapping.resourcePolicy,{signal});signal?.throwIfAborted();return cell.value;
}

export function plotNumericalMetadata(mapping){
 const policy=mapping.numericPolicy??'safe',operation=mapping.operation??'raw',version=mapping.resourcePolicy?2:1;
 return {...(mapping.projection?{algorithm:'exact-affine-rational-to-binary64',version,projection:mapping.projection,errorUnits:'source'}:{algorithm:'exact-rational-to-binary64',version:version+1}),policy,significantDigits:17,...(mapping.resourcePolicy?{resourcePolicy:structuredClone(mapping.resourcePolicy)}:{}),...(operation!=='raw'?{reduction:{algorithm:'exact-rational-reduction',version,operation,grouping:'exact-coordinate',projection:'after-reduction'}}:{})};
}
