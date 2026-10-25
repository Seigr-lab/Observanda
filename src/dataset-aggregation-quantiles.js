import {isWeightedFitMetric,validWeightedFitReceipt} from './web/dataset-weighted-fit-model.js';
// Recipe-owned exact scalars share the existing retained text representation.
import {AppError} from './errors.js';
import {revisionText} from './web/revision-model.js';
import {validAggregation,validQuantileReceipt,isPairStatisticMetric,validPairStatisticReceipt} from './web/dataset-aggregation-model.js';
import {resolveScalarDefinitions,retainScalarDefinitions} from './measurement-scalar-storage.js';
const fail=()=>{throw new AppError('MATERIAL_INVALID');};
export async function prepareAggregationScalars(materials,command,{write,signal,base,allowRetained=false}={}){
 const recipe=command.aggregation;if(![4,5,6,7].includes(recipe?.version))return command;
 if(!validAggregation(recipe))fail();await materials.assertOwner(command.recordId);
 if(!base&&command.id&&command.expectedRevision){const doc=await materials.read({kind:'dataset',id:command.id,revision:command.expectedRevision});if(doc.recordId!==command.recordId)fail();base=doc.content.aggregation;}
 const parameters=metric=>metric.operation==='quantile'?[metric.probability]:isWeightedFitMetric(metric)?[metric.referenceX,...(metric.evaluationX?[metric.evaluationX]:[])]:[],prior=base?.values?.flatMap(parameters).map(value=>value.spelling)??[];
 for(const metric of recipe.values)for(const scalar of parameters(metric))if(typeof scalar.spelling!=='string'&&!allowRetained&&!prior.some(value=>revisionText(value)===revisionText(scalar.spelling)))fail();
 const aggregation=write?await retainScalarDefinitions(materials,recipe,write,{signal,allowRetained:true}):await resolveScalarDefinitions(materials,recipe,{signal});
 return {...command,aggregation};
}
export async function retainAggregationReceipts(materials,rows,policy,write,{signal}={}){
 const value=await retainScalarDefinitions(materials,{aggregation:rows,resourcePolicy:policy},write,{signal,allowRetained:true});return value.aggregation;
}
export async function resolveAggregationReceipts(materials,rows,policy,{signal}={}){
 return (await resolveScalarDefinitions(materials,{aggregation:rows,resourcePolicy:policy},{signal})).aggregation;
}
export function validateAggregationReceipts(recipe,row){
 if(![4,5,6,7].includes(recipe?.version))return;
 if(!Array.isArray(row.aggregation)||row.aggregation.length!==recipe.values.length)throw new AppError('MATERIAL_MISSING');
 for(const [index,metric]of recipe.values.entries()){
  const state=row.aggregation[index],total=row.aggregationMembers?.count??state?.total;
  if(!state||!['included','excluded','missing','total'].every(key=>Number.isSafeInteger(state[key])&&state[key]>=0)||state.total!==total||state.included+state.excluded+state.missing!==total||Object.keys(state).some(key=>!['included','excluded','missing','total',...(metric.operation==='quantile'?['quantile']:isPairStatisticMetric(metric)?['pairedStatistic']:isWeightedFitMetric(metric)?['weightedFit']:[])].includes(key))||metric.operation==='quantile'&&!validQuantileReceipt(state.quantile,recipe.resourcePolicy,state.included,total)||isPairStatisticMetric(metric)&&!validPairStatisticReceipt(state.pairedStatistic,metric,state.included)||isWeightedFitMetric(metric)&&!validWeightedFitReceipt(state.weightedFit,metric,state.included,recipe.resourcePolicy))throw new AppError('MATERIAL_MISSING');
 }
}
