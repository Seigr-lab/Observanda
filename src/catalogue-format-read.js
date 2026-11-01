// A generation scalar belongs to one explicitly immutable read transaction.
// Connection reuse, writer scopes and escaped callbacks never retain it.
import {AsyncLocalStorage} from 'node:async_hooks';
import {catalogueCacheEpoch} from './catalogue-context.js';
import {AppError} from './errors.js';
const reads=new AsyncLocalStorage();
export async function withCatalogueFormatRead(db,operation){
 const scope={db,schema:db.schema,active:true,epoch:null,value:null,token:null};
 const run=operation=>{if(!scope.active||db.schema!==scope.schema||typeof operation!=='function')throw new AppError('INVALID');return reads.run(scope,operation);};
 try{return await run(()=>operation({run}));}finally{scope.active=false;scope.value=null;scope.token=null;}
}
// An opaque lifetime identity for other bounded immutable-read proofs. A new
// transaction, schema, commit boundary or escaped callback cannot reuse it.
export function catalogueReadToken(db){
 const scope=reads.getStore(),epoch=catalogueCacheEpoch(db);
 if(!scope?.active||scope.db!==db||scope.schema!==db.schema||!epoch||typeof scope.schema!=='string'||!/^[a-z][a-z0-9_]{0,62}$/.test(scope.schema))return null;
 if(scope.epoch!==epoch){scope.epoch=epoch;scope.value=null;scope.token={};}
 return scope.token;
}
export async function readCatalogueFormat(db,read){
 if(!catalogueReadToken(db))return read();const scope=reads.getStore();
 if(!scope.value){
  // Qualify the admitted schema explicitly; mutable connection search paths
  // cannot make a different catalogue share this transaction's scalar.
  const value=Promise.resolve().then(()=>read(scope.schema));scope.value=value;
  value.catch(()=>{if(scope.value===value)scope.value=null;});
 }
 return scope.value;
}
