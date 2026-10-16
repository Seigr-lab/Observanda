import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError} from './errors.js';
const scope=new AsyncLocalStorage();let provider=null;
export function installDatabaseProvider(value){
 if(provider)throw new AppError('DATABASE_RUNNING');provider=value;
 return ()=>{if(provider===value)provider=null;};
}
export const databaseProvider=()=>provider;
export const databaseScope=(env,operation,connection)=>scope.run({env,connection},operation);
export const scopedDatabaseEnvironment=()=>scope.getStore()?.env;
export const scopedDatabaseConnection=()=>scope.getStore()?.connection;
export async function workspaceDatabaseEnvironment(root,options={}){return provider?provider.environment(root,options):process.env;}
export async function scratchDatabaseEnvironment(){return scope.getStore()?.env??(provider?await provider.scratch():process.env);}

export async function acquireWorkspaceDatabaseEnvironment(root,options={}){
 if(provider?.acquireEnvironment)return provider.acquireEnvironment(root,options);
 return {env:await workspaceDatabaseEnvironment(root,options),release:()=>{}};
}
