import {setTimeout as delay} from 'node:timers/promises';

// Organization mutations have no external side effects inside this callback.
// The workspace transaction rolls back a failed attempt before it is retried.
// Keep retries bounded: a long import must not hang administration indefinitely.
export async function organizationTransaction(workspace,operation){
  for(let attempt=0;;attempt++){
    try{return await workspace.withLock(operation);}
    catch(error){if(error.code!=='LOCKED'||attempt>=5)throw error;await delay(25*2**attempt);}
  }
}
