import {ArithmeticBudget} from './tools/exact-arithmetic.js';
import {DatasetResourceBudget as SharedDatasetResourceBudget} from './web/dataset-resource-budget.js';
import {defaultDatasetResourcePolicy,validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {AppError} from './errors.js';
// Native callers retain AppError identity; browser and native checks share one core.
export class DatasetResourceBudget extends SharedDatasetResourceBudget{
 constructor(policy=defaultDatasetResourcePolicy()){if(!validDatasetResourcePolicy(policy))throw new AppError('DATASET_CALCULATION');super(policy);}
 run(fn){try{return super.run(fn);}catch(error){if(error.code==='DATASET_CALCULATION_RESOURCE'&&!(error instanceof AppError))throw new AppError('DATASET_CALCULATION_RESOURCE');throw error;}}
 step(){try{return super.step();}catch(error){if(error.code==='DATASET_CALCULATION_RESOURCE')throw new AppError('DATASET_CALCULATION_RESOURCE');throw error;}}
}
export const graphResourceBudget=content=>content.graphVersion>=5?new DatasetResourceBudget(content.policy):null;
export const numericalOperation=(budget,fn)=>budget?.run?budget.run(()=>fn(budget)):fn(budget??new ArithmeticBudget());
