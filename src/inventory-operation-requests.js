import {AppError} from './errors.js';
import {exact,uuid} from './modules/validation.js';
import {MODULE_BYTES} from './modules/capacity.js';
import {moduleDomainRoute} from './module-domain-context.js';
import {inventorySourceQuery} from './inventory-source-query.js';
import {inventoryOperationStatus,resumeInventoryOperation,abortInventoryOperation} from './inventory-operation-coordinator.js';
export function inventoryOperationRequest(route){
 const connection=/^\/api\/modules\/bom\/connections\/(list|open|unlock|close)$/.exec(route),stock=route==='/api/modules/bom/stock',match=/^\/api\/modules\/bom\/operation\/(status|resume|abort)$/.exec(route);
 if(!connection&&!stock&&!match)return null;const action=match?.[1];
 return {write:!connection&&!stock&&action!=='status',limit:MODULE_BYTES,run:async(storage,data,options={})=>{
  const namespaceId=await moduleDomainRoute(storage);if(!namespaceId)throw new AppError('ACCESS_UPGRADE');
  if(data?.workspaceId!==namespaceId)throw new AppError('WORKSPACE_CHANGED');
  const opts={sourceAccess:options.inventorySourceAccess,check:options.check,signal:options.signal};
  if(connection){const access=await options.inventorySourceAccess(namespaceId,{signal:options.signal});try{return await access.connections(connection[1],data);}finally{await access.close();}}
  if(stock)return inventorySourceQuery(storage,namespaceId,data,opts);
  const key=action==='status'&&Object.hasOwn(data,'bomId')?'bomId':'id';
  if(!exact(data,['workspaceId',key])||!uuid(data[key]))throw new AppError('INVALID');
  return ({status:inventoryOperationStatus,resume:resumeInventoryOperation,abort:abortInventoryOperation})[action](storage,namespaceId,{[key]:data[key]},opts);
 }};
}
