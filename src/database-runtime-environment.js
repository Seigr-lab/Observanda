// Runtime capabilities stay in process; database URLs carry no lifecycle flags.
// Scoped scratch connections retain the same owner as their source connection.
const owners=new WeakMap();
export function registerRuntimeEnvironment(environment,retain){owners.set(environment,retain);}
export function retainRuntimeEnvironment(environment){return owners.get(environment)?.()??(()=>{});}
const storage=new WeakMap();
// Managed owners alone publish local storage authority. Copies must explicitly
// inherit it; a URL or workspace-looking environment field grants no authority.
export function registerRuntimeStorage(environment,directory){const value={directory,url:environment.OBSERVANDA_DATABASE_URL,active:true};storage.set(environment,value);return ()=>{value.active=false;};}
export function inheritRuntimeStorage(source,target){const value=storage.get(source);if(value?.active&&source.OBSERVANDA_DATABASE_URL===value.url&&target.OBSERVANDA_DATABASE_URL===value.url)storage.set(target,value);}
export function runtimeStorageDirectory(environment){const value=storage.get(environment);return value?.active&&environment.OBSERVANDA_DATABASE_URL===value.url?value.directory:null;}
