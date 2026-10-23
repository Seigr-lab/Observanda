import {ArithmeticBudget} from './tools/exact-arithmetic.js';
import {defaultDatasetResourcePolicy,validDatasetResourcePolicy,DatasetResourceError} from './web/dataset-resource-policy.js';
import {AppError} from './errors.js';
// Timed sections contain synchronous numerical work only; source/storage awaits are outside.
export class DatasetResourceBudget extends ArithmeticBudget{
 constructor(policy=defaultDatasetResourcePolicy()){if(!validDatasetResourcePolicy(policy))throw new AppError('DATASET_CALCULATION');super(policy.resources);this.scalarPolicy=policy;this.remaining=policy.resources.maxMilliseconds;this.depth=0;this.deadline=Infinity;}
 run(fn){if(this.depth++)try{return fn();}finally{this.depth--;}const start=performance.now();this.deadline=Date.now()+this.remaining;try{const value=fn();this.step();return value;}catch(error){if(error instanceof DatasetResourceError||/calculation resource budget/.test(error.message))throw new AppError('DATASET_CALCULATION_RESOURCE');throw error;}finally{this.remaining-=performance.now()-start;this.deadline=Infinity;this.depth--;}}
 step(){if(++this.operations>this.maxOperations||Date.now()>this.deadline||this.remaining<0)throw new AppError('DATASET_CALCULATION_RESOURCE');}
}
export const graphResourceBudget=content=>content.graphVersion===5?new DatasetResourceBudget(content.policy):null;
export const numericalOperation=(budget,fn)=>budget?.run?budget.run(()=>fn(budget)):fn(budget??new ArithmeticBudget());
