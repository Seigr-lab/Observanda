// Capability dispatch is loaded lazily by storage to avoid eager module cycles.
// Reuse only these predicates and functions; every write checks its own database.
import {requirePublicationOperations} from './catalogue-format.js';
import {publicationOperationMetadataPath,publicationOperationMetadata} from './publication-operation-format.js';
import {requirePagedResearchTables,requireReferencedCalculations,requireNativeNumericalModels,requireNativeClockModels,requireNativeDomainValues,requireClockDerivations,requireIntervalUncertainty,requireWindowCalculations,requireFigureProjectionPolicies,requireAxisPermutation,requireStatisticalUncertainty,requireMeasurementScalarPolicies,requireDatasetResourcePolicies,requireStructuredCalculator,requireApproximateCalculator,requirePairedStatistics,requireQuantileAggregation,requireWeightedFit,requireCoordinateAlignment,requireSpectralMethods,requireTopologyValues,requireSequenceValues,requireTensorValues,requireNumericalExecution,requireDatasetCusum,requireDatasetSpectra,requireComputedCells,requireCoordinateFrames,requireSegmentedClockSynchronization,requireClockSynchronization,requireDomainAlgebra,requireCalculatorDatasetResults,requireCalculationPolicies,requireReviewFigurePackages} from './catalogue-format.js';
import {referencedCalculationMetadata} from './calculation-graph-format.js';
import {nativeNumericalMetadata,nativeClockMetadata} from './numerical-material-format.js';
import {nativeDomainMetadata} from './native-domain-format.js';
import {clockDerivationMetadata} from './clock-derivation-format.js';
import {intervalUncertaintyMetadata} from './interval-uncertainty-format.js';
import {windowCalculationMetadata} from './dataset-window-format.js';
import {plotResourceMetadata} from './plot-resource-format.js';
import {axisPermutationMetadata} from './axis-permutation-format.js';
import {statisticalUncertaintyMetadata} from './statistical-uncertainty-format.js';
import {pairedStatisticsMetadata} from './paired-statistics-format.js';
import {quantileAggregationMetadata} from './quantile-aggregation-format.js';
import {weightedFitMetadata} from './weighted-fit-format.js';
import {coordinateAlignmentMetadata} from './coordinate-alignment-format.js';
import {spectralMethodsMetadata} from './spectral-methods-format.js';
import {topologyValuesMetadata} from './topology-values-format.js';
import {sequenceValuesMetadata} from './sequence-values-format.js';
import {tensorValuesMetadata} from './tensor-values-format.js';
import {numericalExecutionMetadata} from './numerical-execution-format.js';
import {cusumMetadata} from './dataset-cusum-format.js';
import {spectrumMetadata} from './dataset-spectrum-format.js';
import {computedCellMetadata} from './computed-cell-format.js';
import {coordinateFrameMetadata} from './coordinate-frame-format.js';
import {segmentedClockSynchronizationMetadata} from './segmented-clock-synchronization-format.js';
import {clockSynchronizationMetadata} from './clock-synchronization-format.js';
import {domainAlgebraMetadata} from './domain-algebra-format.js';
import {measurementScalarMetadata} from './measurement-scalar-format.js';
import {approximateCalculatorMetadata} from './approximate-calculator-format.js';
import {structuredCalculatorMetadata,checkpointHasStructuredCalculator} from './structured-calculator-format.js';
import {calculatorResultMetadata} from './web/calculator-result-model.js';
import {datasetResourceMetadata} from './dataset-resource-format.js';
import {checkpointHasCalculationPolicy} from './web/tools/calculation-policy.js';
export async function requireMetadataCatalogueFormat(db,relative,text){
 if(publicationOperationMetadataPath(relative)&&publicationOperationMetadata(relative,JSON.parse(text)))await requirePublicationOperations(db);
 if(relative.startsWith('.observanda/materials/')||relative.startsWith('.observanda/jobs/')){
   const value=JSON.parse(text);if(value.content?.datasetFormat===3||relative.startsWith('.observanda/materials/sequences/chunks/')&&['cells','cell-text'].includes(value.kind)){await requirePagedResearchTables(db);}
   if(referencedCalculationMetadata(relative,value)){await requireReferencedCalculations(db);}
   if(nativeNumericalMetadata(relative,value)){await requireNativeNumericalModels(db);}
   if(nativeClockMetadata(relative,value)){await requireNativeClockModels(db);}
   if(nativeDomainMetadata(relative,value)){await requireNativeDomainValues(db);}
   if(clockDerivationMetadata(relative,value)){await requireClockDerivations(db);}
   if(intervalUncertaintyMetadata(relative,value)){await requireIntervalUncertainty(db);}
   if(windowCalculationMetadata(relative,value)){await requireWindowCalculations(db);}
   if(plotResourceMetadata(relative,value)){await requireFigureProjectionPolicies(db);}
   if(axisPermutationMetadata(relative,value)){await requireAxisPermutation(db);}
   if(statisticalUncertaintyMetadata(relative,value)){await requireNativeNumericalModels(db);await requireMeasurementScalarPolicies(db);await requireDatasetResourcePolicies(db);await requireStructuredCalculator(db);await requireApproximateCalculator(db);await requireStatisticalUncertainty(db);}
   if(pairedStatisticsMetadata(relative,value)){await requireMeasurementScalarPolicies(db);await requireDatasetResourcePolicies(db);await requireQuantileAggregation(db);await requirePairedStatistics(db);}
   if(quantileAggregationMetadata(relative,value)){await requireMeasurementScalarPolicies(db);await requireDatasetResourcePolicies(db);await requireQuantileAggregation(db);}
   if(weightedFitMetadata(relative,value)){await requireWeightedFit(db);}
   if(coordinateAlignmentMetadata(relative,value)){await requireCoordinateAlignment(db);}
   if(spectralMethodsMetadata(relative,value)){await requireSpectralMethods(db);}
   if(topologyValuesMetadata(relative,value)){await requireTopologyValues(db);}
   if(sequenceValuesMetadata(relative,value)){await requireSequenceValues(db);}
   if(tensorValuesMetadata(relative,value)){await requireTensorValues(db);}
   if(numericalExecutionMetadata(relative,value)){await requireNumericalExecution(db);}
   if(cusumMetadata(relative,value)){await requireDatasetCusum(db);}
   if(spectrumMetadata(relative,value)){await requireDatasetSpectra(db);}
   if(computedCellMetadata(relative,value)){await requireComputedCells(db);}
   if(coordinateFrameMetadata(relative,value)){await requireCoordinateFrames(db);}
   if(segmentedClockSynchronizationMetadata(relative,value)){await requireMeasurementScalarPolicies(db);await requireDatasetResourcePolicies(db);await requireClockSynchronization(db);await requireSegmentedClockSynchronization(db);}
   if(clockSynchronizationMetadata(relative,value)){await requireClockSynchronization(db);}
   if(domainAlgebraMetadata(relative,value)){await requireDomainAlgebra(db);}
   if(measurementScalarMetadata(relative,value)){await requireMeasurementScalarPolicies(db);}
   if(approximateCalculatorMetadata(relative,value)){await requireApproximateCalculator(db);}
   if(structuredCalculatorMetadata(relative,value)){await requireStructuredCalculator(db);}
   if(calculatorResultMetadata(relative,value)){await requireCalculatorDatasetResults(db);}
   if(datasetResourceMetadata(relative,value)){await requireDatasetResourcePolicies(db);}
 }
 if(/^\.observanda\/module-drafts\/[a-f0-9-]{36}\.json$/.test(relative)){
   if(checkpointHasStructuredCalculator(JSON.parse(text))){await requireStructuredCalculator(db);}
   if(checkpointHasCalculationPolicy(JSON.parse(text))){await requireCalculationPolicies(db);}
 }
 if(relative.startsWith('.observanda/reviews/parts/')||/^\.observanda\/reviews\/[a-f0-9-]{36}\.json$/.test(relative)&&JSON.parse(text)?.request?.value?.version===2){
   await requireReviewFigurePackages(db);
 }
}
