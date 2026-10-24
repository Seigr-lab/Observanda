// Pure in-memory execution of one ALREADY PERSISTED numerical reservation.
// The caller owns lease-fenced checkpoint I/O; this module never writes state.
import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {DatasetResourceError,validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {NumericalExecutionError,validateNumericalExecutionState} from './web/numerical-execution-policy.js';
export {createNumericalExecutionState,reserveNumericalExecution,settleNumericalExecution,recoverNumericalExecution,validateNumericalExecutionState,validNumericalExecutionState} from './web/numerical-execution-policy.js';
const invalid=()=>{throw new NumericalExecutionError();};
const resource=()=>{throw new DatasetResourceError();};
export class NumericalExecutionBudget{
 #state;#operations=0;#active=0;#depth=0;#started=0;#last=0;#finished=null;#signal;#check;#now;
 constructor(reservedState,{identity,policy,signal,check,now=()=>performance.now()}={}){
  validateNumericalExecutionState(reservedState,{identity,policy});if(!reservedState.reservation||typeof now!=='function'||check!==undefined&&typeof check!=='function')invalid();
  this.#state=structuredClone(reservedState);this.#signal=signal;this.#check=check;this.#now=now;this.#last=this.#time();
 }
 get policy(){return structuredClone(this.#state.policy);}
 #time(){const value=this.#now();if(!Number.isFinite(value)||value<0||value<this.#last||value>Number.MAX_SAFE_INTEGER)invalid();this.#last=value;return value;}
 #assert(){if(this.#finished)invalid();this.#signal?.throwIfAborted();if(this.#active+(this.#depth?this.#time()-this.#started:0)>this.#state.reservation.activeMilliseconds)resource();}
 step(count=1){if(!this.#depth||!Number.isSafeInteger(count)||count<1)invalid();this.#assert();if(this.#operations+count>this.#state.reservation.operations)resource();this.#operations+=count;}
 // Synchronous nested scopes debit CPU once. Await reads/writes/checks outside
 // run(); accepting a Promise here would silently omit its numerical work.
 run(operation){
  if(typeof operation!=='function'||operation.constructor?.name==='AsyncFunction')invalid();this.#assert();const outer=this.#depth===0;if(outer)this.#started=this.#time();this.#depth++;let failed=false;
  try{const value=operation(this);if(value&&typeof value.then==='function')invalid();this.#assert();return value;}
  catch(error){failed=true;throw error;}
  finally{this.#depth--;if(outer){this.#active+=this.#time()-this.#started;if(!failed)this.#assert();}}
 }
 async check(){this.#assert();await this.#check?.();this.#assert();}
 usage(){if(this.#depth)invalid();return this.#finished?{...this.#finished}:{id:this.#state.reservation.id,sequence:this.#state.reservation.sequence,operations:this.#operations,activeMilliseconds:this.#active};}
 // Call even after cancellation/resource refusal, then persist settlement. Once
 // sealed this object cannot perform more work against the settled reservation.
 finish(){if(this.#depth)invalid();if(!this.#finished)this.#finished=Object.freeze(this.usage());return {...this.#finished};}
 // Each source/scalar operation gets its original local bounds AND debits this
 // same slice. Recreating a scalar budget never recreates the slice allowance.
 scalarBudget(policy){
  this.#assert();if(!validDatasetResourcePolicy(policy))invalid();const execution=this,saved=structuredClone(policy);Object.freeze(saved.resources);Object.freeze(saved);
  return new class extends DatasetResourceBudget{
   constructor(){super(saved);}
   step(){super.step();execution.step();}
   run(operation){return execution.run(()=>super.run(operation));}
  }();
 }
}
