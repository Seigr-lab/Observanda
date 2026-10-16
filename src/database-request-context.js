import {AsyncLocalStorage} from 'node:async_hooks';
const requests=new AsyncLocalStorage();
export const withDatabaseRequest=(signal,operation)=>requests.run({signal},operation);
export const databaseRequestSignal=()=>requests.getStore()?.signal;
