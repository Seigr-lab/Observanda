import {setImmediate as nextTurn} from 'node:timers/promises';

// Awaiting a cached read only drains microtasks. Occasionally release the
// event loop so cancellation, leases and foreground requests can run as well.
// Scheduling time stays outside the caller's synchronous arithmetic budget.
export function cooperativeCheckpoint({signal}={}){
 let previous=performance.now();
 return async()=>{
  signal?.throwIfAborted();if(performance.now()-previous<8)return;
  await nextTurn();previous=performance.now();signal?.throwIfAborted();
 };
}
