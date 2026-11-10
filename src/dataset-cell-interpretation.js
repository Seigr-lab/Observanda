import {AppError} from './errors.js';
import {revisionText} from './web/revision-model.js';
import {supportedValue} from './web/measurement-model.js';
import {perCellComputation,resolveCellComputation} from './web/measurement-computation.js';
import {verifyCoordinateAlignment} from './coordinate-alignment.js';
import {retainDatasetCell,datasetCellReference} from './dataset-cell-storage.js';
import {retainDomainValue,domainValueReference,validateDomainValue} from './measurement-domain-storage.js';
import {resolveScalarOperand} from './measurement-scalar-storage.js';
import {policyScalarText} from './dataset-resource-values.js';
import {clockScalarText,intervalScalarText} from './dataset-scalar-text.js';
import {calculatorResultScalar} from './calculator-results.js';

const invalid=()=>{throw new AppError('MATERIAL_INVALID');};

// The review path uses the same interpretation and the same source spelling
// as a retained dataset, with only its sequence writer backed by scratch.
export async function interpretDatasetCell(materials,raw,column,save,{calculation,calculatorResult,signal}={}){
 const supplied=domainValueReference(raw.value)&&(column.representation!=='domain'||revisionText(raw.value.definition)!==revisionText(column.domain))
  ?{...raw,value:raw.value.original}:raw;
 let cell=await retainDatasetCell(materials,supplied,save);
 if(!!cell.coordinateAlignment!==!!column.coordinateAlignment)invalid();
 if(cell.coordinateAlignment)await verifyCoordinateAlignment(materials,cell.coordinateAlignment,{column:column.coordinateAlignment,signal});
 if(perCellComputation(column))resolveCellComputation(column,cell);
 if(['null','absent'].includes(cell.kind))return cell;
 const missing=column.missing.some(item=>item.value===cell.value);
 if(column.representation==='domain'&&!missing)cell={...cell,value:await retainDomainValue(materials,cell,column.domain,save,{signal})};
 if(domainValueReference(cell.value)){
  if(column.representation!=='domain')invalid();
  validateDomainValue(materials,cell.value,column.domain);
 }else if(column.resourcePolicy&&!missing)await resolveScalarOperand(materials,cell,column,{signal});
 else if(datasetCellReference(cell.value)){
  if(!['text','unsupported'].includes(column.representation)&&
   !await policyScalarText(materials,cell.value,column,calculation,cell.lineage,{signal})&&
   !await clockScalarText(materials,cell.value,column,calculation,cell.lineage,{signal})&&
   !await intervalScalarText(materials,cell.value,column,calculation,cell.lineage,{signal})&&
   !await calculatorResultScalar(materials,cell.value,column,calculatorResult,{signal}))invalid();
 }else if(!missing&&!supportedValue(cell.value,column.representation,column.radix)&&
  !await policyScalarText(materials,cell.value,column,calculation,cell.lineage,{signal})&&
  !await calculatorResultScalar(materials,cell.value,column,calculatorResult,{signal}))invalid();
 return cell;
}
