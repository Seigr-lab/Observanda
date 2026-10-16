// Runtime capabilities stay in process; database URLs carry no lifecycle flags.
// Scoped scratch connections retain the same owner as their source connection.
const owners=new WeakMap();
export function registerRuntimeEnvironment(environment,retain){owners.set(environment,retain);}
export function retainRuntimeEnvironment(environment){return owners.get(environment)?.()??(()=>{});}
