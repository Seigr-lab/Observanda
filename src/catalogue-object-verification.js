import {weightedFitMetadata,assertWeightedFitFormat} from './weighted-fit-format.js';
import {coordinateAlignmentMetadata,assertCoordinateAlignmentFormat} from './coordinate-alignment-format.js';
import {spectralMethodsMetadata,assertSpectralMethodsFormat} from './spectral-methods-format.js';
import {topologyValuesMetadata,assertTopologyValuesFormat} from './topology-values-format.js';
import {sequenceValuesMetadata,assertSequenceValuesFormat} from './sequence-values-format.js';
import {cusumMetadata,assertCusumFormat} from './dataset-cusum-format.js';
import {numericalExecutionMetadata,assertNumericalExecutionFormat} from './numerical-execution-format.js';
import {spectrumMetadata,assertSpectrumFormat} from './dataset-spectrum-format.js';
import {computedCellMetadata,assertComputedCellFormat} from './computed-cell-format.js';
import {coordinateFrameMetadata,assertCoordinateFrameFormat} from './coordinate-frame-format.js';
import {segmentedClockSynchronizationMetadata,assertSegmentedClockSynchronizationFormat} from './segmented-clock-synchronization-format.js';
import {statisticalUncertaintyMetadata,assertStatisticalUncertaintyFormat} from './statistical-uncertainty-format.js';
import {pairedStatisticsMetadata} from './paired-statistics-format.js';
import {catalogueRequiresPairedStatistics} from './catalogue-format.js';
import {axisPermutationMetadata} from './axis-permutation-format.js';
import {catalogueRequiresAxisPermutation} from './catalogue-format.js';
import {quantileAggregationMetadata} from './quantile-aggregation-format.js';
import {catalogueRequiresQuantileAggregation,catalogueRequiresDatasetResourcePolicies} from './catalogue-format.js';
import {tensorValuesMetadata} from './tensor-values-format.js';
import {catalogueRequiresTensorValues} from './catalogue-format.js';
import {clockSynchronizationMetadata} from './clock-synchronization-format.js';
import {catalogueRequiresClockSynchronization} from './catalogue-format.js';
import {approximateCalculatorMetadata} from './approximate-calculator-format.js';
import {catalogueRequiresApproximateCalculator} from './catalogue-format.js';
import {checkpointHasStructuredCalculator,structuredCalculatorMetadata} from './structured-calculator-format.js';
import {catalogueRequiresStructuredCalculator} from './catalogue-format.js';
import {domainAlgebraMetadata} from './domain-algebra-format.js';
import {catalogueRequiresDomainAlgebra} from './catalogue-format.js';
import {measurementScalarMetadata} from './measurement-scalar-format.js';
import {catalogueRequiresMeasurementScalarPolicies} from './catalogue-format.js';
import {calculatorResultMetadata} from './web/calculator-result-model.js';
import {catalogueRequiresCalculatorDatasetResults} from './catalogue-format.js';
import {catalogueFormat,catalogueRequiresCalculationPolicies} from './catalogue-format.js';
import {checkpointHasCalculationPolicy} from './web/tools/calculation-policy.js';
import {resolveMetadataValue} from './project-retired-metadata.js';
// Authenticate all retained metadata independently of any optional module.
// Small payloads travel in bounded batches; larger originals travel alone.
import {ObjectIndex} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {operationAdvance,operationTotal} from './operation-progress.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function* verifiedCatalogueObjects(store){
 const index=new ObjectIndex(store,{cacheReads:true,scanAhead:true}),head=await index.head();await index.checkCounts(head);
 operationTotal(head.legacy?.length??head.root?.count??0);
 const batch=[];let weightedFitAdmission,coordinateAlignmentAdmission,spectralMethodsAdmission,topologyAdmission,sequenceAdmission,cusumAdmission,numericalExecutionAdmission,spectrumAdmission,computedCellAdmission,coordinateFrameAdmission,segmentedClockAdmission,statisticalUncertaintyAdmission,policyAdmission,resultAdmission,scalarAdmission,domainAlgebraAdmission,structuredAdmission,approximateAdmission,clockSynchronizationAdmission,tensorAdmission,quantileAdmission,axisPermutationAdmission,pairedStatisticsAdmission;
 async function* values(){
  const rows=new Map((await store.db.all('SELECT id,payload FROM objects WHERE id=ANY($1::text[]) AND octet_length(payload)<=16384',batch.map(entry=>entry.id))).map(row=>[row.id,row.payload]));
  for(const entry of batch){
   let value;
   if(rows.has(entry.id)){value=await resolveMetadataValue(store,entry.id,entry.revision,store.decode('object',entry.id,rows.get(entry.id)));if(digest(serialize(value))!==entry.revision)fail();}
   else value=await store.objectValue(entry.id,entry);
   if(/^metadata:\.observanda\/module-drafts\/[a-f0-9-]{36}\.json$/.test(entry.id)){
    let checkpoint;try{checkpoint=JSON.parse(value.text);}catch{fail();}
    if(checkpointHasStructuredCalculator(checkpoint)){structuredAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresStructuredCalculator);if(!await structuredAdmission)fail();}
    if(checkpointHasCalculationPolicy(checkpoint)){policyAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresCalculationPolicies);if(!await policyAdmission)fail();}
   }
   if(entry.id.startsWith('metadata:.observanda/materials/objects/')||entry.id.startsWith('metadata:.observanda/jobs/')){let metadata;try{metadata=JSON.parse(value.text);}catch{fail();}if(structuredCalculatorMetadata(entry.id.slice(9),metadata)){structuredAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresStructuredCalculator);if(!await structuredAdmission)fail();}if(calculatorResultMetadata(entry.id.slice(9),metadata)){resultAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresCalculatorDatasetResults);if(!await resultAdmission)fail();}}
   if(entry.id.startsWith('metadata:.observanda/materials/')||entry.id.startsWith('metadata:.observanda/jobs/')){let metadata;try{metadata=JSON.parse(value.text);}catch{fail();}if(numericalExecutionMetadata(entry.id.slice(9),metadata)){numericalExecutionAdmission??=assertNumericalExecutionFormat(store.workspace);await numericalExecutionAdmission;}if(cusumMetadata(entry.id.slice(9),metadata)){cusumAdmission??=assertCusumFormat(store.workspace);await cusumAdmission;}if(spectrumMetadata(entry.id.slice(9),metadata)){spectrumAdmission??=assertSpectrumFormat(store.workspace);await spectrumAdmission;}if(computedCellMetadata(entry.id.slice(9),metadata)){computedCellAdmission??=assertComputedCellFormat(store.workspace);await computedCellAdmission;}if(coordinateFrameMetadata(entry.id.slice(9),metadata)){coordinateFrameAdmission??=assertCoordinateFrameFormat(store.workspace);await coordinateFrameAdmission;}if(segmentedClockSynchronizationMetadata(entry.id.slice(9),metadata)){segmentedClockAdmission??=assertSegmentedClockSynchronizationFormat(store.workspace);await segmentedClockAdmission;}if(statisticalUncertaintyMetadata(entry.id.slice(9),metadata)){statisticalUncertaintyAdmission??=assertStatisticalUncertaintyFormat(store.workspace);await statisticalUncertaintyAdmission;}if(pairedStatisticsMetadata(entry.id.slice(9),metadata)){pairedStatisticsAdmission??=catalogueFormat(store.catalogueDb??store.db).then(format=>catalogueRequiresPairedStatistics(format)&&catalogueRequiresQuantileAggregation(format)&&catalogueRequiresMeasurementScalarPolicies(format)&&catalogueRequiresDatasetResourcePolicies(format));if(!await pairedStatisticsAdmission)fail();}if(axisPermutationMetadata(entry.id.slice(9),metadata)){axisPermutationAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresAxisPermutation);if(!await axisPermutationAdmission)fail();}if(quantileAggregationMetadata(entry.id.slice(9),metadata)){quantileAdmission??=catalogueFormat(store.catalogueDb??store.db).then(format=>catalogueRequiresQuantileAggregation(format)&&catalogueRequiresMeasurementScalarPolicies(format)&&catalogueRequiresDatasetResourcePolicies(format));if(!await quantileAdmission)fail();}if(weightedFitMetadata(entry.id.slice(9),metadata)){weightedFitAdmission??=assertWeightedFitFormat(store.workspace);await weightedFitAdmission;}if(coordinateAlignmentMetadata(entry.id.slice(9),metadata)){coordinateAlignmentAdmission??=assertCoordinateAlignmentFormat(store.workspace);await coordinateAlignmentAdmission;}if(spectralMethodsMetadata(entry.id.slice(9),metadata)){spectralMethodsAdmission??=assertSpectralMethodsFormat(store.workspace);await spectralMethodsAdmission;}if(topologyValuesMetadata(entry.id.slice(9),metadata)){topologyAdmission??=assertTopologyValuesFormat(store.workspace);await topologyAdmission;}if(sequenceValuesMetadata(entry.id.slice(9),metadata)){sequenceAdmission??=assertSequenceValuesFormat(store.workspace);await sequenceAdmission;}if(tensorValuesMetadata(entry.id.slice(9),metadata)){tensorAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresTensorValues);if(!await tensorAdmission)fail();}if(clockSynchronizationMetadata(entry.id.slice(9),metadata)){clockSynchronizationAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresClockSynchronization);if(!await clockSynchronizationAdmission)fail();}if(approximateCalculatorMetadata(entry.id.slice(9),metadata)){approximateAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresApproximateCalculator);if(!await approximateAdmission)fail();}if(domainAlgebraMetadata(entry.id.slice(9),metadata)){domainAlgebraAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresDomainAlgebra);if(!await domainAlgebraAdmission)fail();}if(measurementScalarMetadata(entry.id.slice(9),metadata)){scalarAdmission??=catalogueFormat(store.catalogueDb??store.db).then(catalogueRequiresMeasurementScalarPolicies);if(!await scalarAdmission)fail();}}
   yield {id:entry.id,value};operationAdvance();
  }
  batch.length=0;
 }
 for await(const entry of index.entries(head)){batch.push(entry);if(batch.length===32)yield* values();}
 if(batch.length)yield* values();
}
