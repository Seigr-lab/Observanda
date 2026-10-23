import {ArithmeticBudget} from './exact-arithmetic-budget.js';
import {defaultDatasetResourcePolicy,validDatasetResourcePolicy,DatasetResourceError} from './dataset-resource-policy.js';
// Timed sections contain synchronous numerical work only; storage waits are excluded.
export class DatasetResourceBudget extends ArithmeticBudget{
 constructor(policy=defaultDatasetResourcePolicy()){if(!validDatasetResourcePolicy(policy))throw Error('Invalid exact resource policy.');super(policy.resources);this.scalarPolicy=policy;this.remaining=policy.resources.maxMilliseconds;this.depth=0;this.deadline=Infinity;}
 run(fn){if(this.depth++)try{return fn();}finally{this.depth--;}const start=performance.now();this.deadline=Date.now()+this.remaining;try{const value=fn();this.step();return value;}catch(error){if(error instanceof DatasetResourceError||/calculation resource budget/.test(error.message))throw new DatasetResourceError();throw error;}finally{this.remaining-=performance.now()-start;this.deadline=Infinity;this.depth--;}}
 step(){if(++this.operations>this.maxOperations||Date.now()>this.deadline||this.remaining<0)throw new DatasetResourceError();}
}
