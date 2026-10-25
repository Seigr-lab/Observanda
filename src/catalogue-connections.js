// Reuse authenticated connections within one operation, never its transactions.
// Separate read/write queues preserve fresh read snapshots and short writes.
import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError} from './errors.js';
import {assertWorkspaceAvailable} from './workspace-lifecycle-admission.js';
const scopes=new AsyncLocalStorage();
function validate(scope,workspace){
 if(scope.root!==workspace.root||scope.projectId!==(workspace.projectId??null)||scope.labBookId!==(workspace.labBookId??null))throw new AppError('DATABASE_LOCATION');
 if(scope.vaultId!==workspace.vault?.id||!Buffer.isBuffer(workspace.vault?.key)||!scope.key.equals(workspace.vault.key))throw new AppError('ACCESS_DENIED');
}
// The explicit owner spans sequential callbacks, but no transaction spans them.
// It is request-owned, and may retain only its selected workspace's connections.
function connectionOwner(workspace,{lateIndependent=false}={}){
 if(!Buffer.isBuffer(workspace.vault?.key))throw new AppError('ACCESS_LOCKED');
 const scope={root:workspace.root,projectId:workspace.projectId??null,labBookId:workspace.labBookId??null,vaultId:workspace.vault.id,key:Buffer.from(workspace.vault.key),entries:new Map(),closed:false,lateIndependent};
 const pending=new Set(),running=new AsyncLocalStorage();let closing=false,closed;
 return {
  async run(operation){
   if(closing)throw new AppError('ACCESS_LOCKED');validate(scope,workspace);
   const context=new Map([...(scopes.getStore()??[]),[workspace,scope]]);
   const invocation={active:true};
   const result=Promise.resolve().then(()=>scopes.run(context,()=>running.run(invocation,operation)));pending.add(result);
   const finished=()=>{invocation.active=false;pending.delete(result);};result.then(finished,finished);return result;
  },
  close(){
   // A callback cannot drain itself. Do not start closing on this refusal, so
   // its caller can still close normally after the accepted callback settles.
   if(running.getStore()?.active)return Promise.reject(new AppError('LOCKED'));
   if(closed)return closed;closing=true;
   return closed=(async()=>{
    // A callback may still be checking its grant before entering a transaction.
    // Drain that accepted work before closing the queues or clearing the key.
    await Promise.allSettled([...pending]);scope.closed=true;
    try{
     const results=await Promise.allSettled([...scope.entries.values()].map(async entry=>{await entry.tail;await entry.db?.close();}));
     const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    }finally{scope.key.fill(0);}
   })();
  }
 };
}
export function createCatalogueConnections(workspace){return connectionOwner(workspace);}
export async function withCatalogueConnections(workspace,operation){
 const prior=scopes.getStore()?.get(workspace);
 if(prior&&!prior.closed){validate(prior,workspace);return operation();}
 const owner=connectionOwner(workspace,{lateIndependent:true});
 try{return await owner.run(operation);}finally{await owner.close();}
}
async function independent(workspace,options,operation){
 const db=await workspace.openCatalogue(options);let failed=false;
 try{return await operation(db);}catch(error){failed=true;throw error;}
 finally{try{await db.close();}catch(error){if(!failed)throw error;}}
}
export async function catalogueConnection(workspace,kind,options,operation){
 const scope=scopes.getStore()?.get(workspace);
 if(!scope||scope.closed&&scope.lateIndependent)return independent(workspace,options,operation);
 if(scope.closed)throw new AppError('ACCESS_LOCKED');
 validate(scope,workspace);
 const key=JSON.stringify({detached:options.detached??false,moveId:options.moveId??null});
 let entry=scope.entries.get(kind);
 if(entry&&entry.key!==key)return independent(workspace,options,operation);
 if(!entry){entry={key,tail:Promise.resolve(),db:null};scope.entries.set(kind,entry);}
 const pending=entry.tail.then(async()=>{
  validate(scope,workspace);
  // Fresh opens perform their own lifecycle admission; reused connections
  // must recheck it before every transaction.
  if(entry.db)await assertWorkspaceAvailable(workspace.root,{moveId:options.moveId});
  else entry.db=await workspace.openCatalogue(options);
  try{return await operation(entry.db);}
  catch(error){const db=entry.db;entry.db=null;await db.close().catch(()=>{});throw error;}
 });
 // Drain already accepted work before closing, even if its caller stops early.
 entry.tail=pending.then(()=>{},()=>{});return pending;
}
