import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const accessDevice=()=>context.getStore()??null;
export const withAccessDevice=(deviceStore,operation)=>context.run(deviceStore,operation);
