// Reuse authenticated connections within one operation, never its transactions.
// Separate read/write queues preserve fresh read snapshots and short writes.
import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError} from './errors.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotMoving} from './workspace-move-state.js';
import {assertNotRenaming} from './workspace-rename-state.js';
const scopes=new AsyncLocalStorage();
function validate(scope,workspace){
 if(scope.root!==workspace.root||scope.projectId!==(workspace.projectId??null)||scope.labBookId!==(workspace.labBookId??null))throw new AppError('DATABASE_LOCATION');
 if(scope.vaultId!==workspace.vault?.id||!Buffer.isBuffer(workspace.vault?.key)||!scope.key.equals(workspace.vault.key))throw new AppError('ACCESS_DENIED');
}
export async function withCatalogueConnections(workspace,operation){
 const parent=scopes.getStore(),prior=parent?.get(workspace);
 if(prior&&!prior.closed){validate(prior,workspace);return operation();}
 if(!Buffer.isBuffer(workspace.vault?.key))throw new AppError('ACCESS_LOCKED');
 const scope={root:workspace.root,projectId:workspace.projectId??null,labBookId:workspace.labBookId??null,vaultId:workspace.vault.id,key:Buffer.from(workspace.vault.key),entries:new Map(),closed:false};
 try{return await scopes.run(new Map([...(parent??[]),[workspace,scope]]),operation);}
 finally{
  scope.closed=true;
  try{
   const closed=await Promise.allSettled([...scope.entries.values()].map(async entry=>{await entry.tail;await entry.db?.close();}));
   const failed=closed.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  }finally{scope.key.fill(0);}
 }
}
async function independent(workspace,options,operation){const db=await workspace.openCatalogue(options);try{return await operation(db);}finally{await db.close();}}
export async function catalogueConnection(workspace,kind,options,operation){
 const scope=scopes.getStore()?.get(workspace);
 if(!scope||scope.closed)return independent(workspace,options,operation);
 validate(scope,workspace);
 const key=JSON.stringify({detached:options.detached??false,moveId:options.moveId??null});
 let entry=scope.entries.get(kind);
 if(entry&&entry.key!==key)return independent(workspace,options,operation);
 if(!entry){entry={key,tail:Promise.resolve(),db:null};scope.entries.set(kind,entry);}
 const pending=entry.tail.then(async()=>{
  validate(scope,workspace);
  await assertNotDeleting(workspace.root);await assertNotMoving(workspace.root,options.moveId);await assertNotRenaming(workspace.root);
  entry.db??=await workspace.openCatalogue(options);
  try{return await operation(entry.db);}
  catch(error){const db=entry.db;entry.db=null;await db.close().catch(()=>{});throw error;}
 });
 // Drain already accepted work before closing, even if its caller stops early.
 entry.tail=pending.then(()=>{},()=>{});return pending;
}
