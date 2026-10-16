// Validate changed foreign draft choices before taking the result BOM writer.
import {inventoryOwnerTransaction} from './inventory-operation-transaction.js';
import {requireValue,uuid} from './modules/validation.js';
import {AppError} from './errors.js';
const key=(ref,fields)=>JSON.stringify([ref.workspaceId,ref.id,fields.unit,fields.sourceProjectId]);
export async function prepareInventoryBOMResources(storage,workspaceId,command,{sourceAccess,check,signal}={}){
 if(command.action!=='bom.save'||!Array.isArray(command.payload.data?.lines)||!uuid(command.payload.id))return null;
 const foreign=command.payload.data.lines.filter(line=>line.resourceId&&typeof line.resourceId==='object'&&line.resourceId.workspaceId!==workspaceId);if(!foreign.length)return null;
 const old=await inventoryOwnerTransaction(storage,workspaceId,'bom',{check,signal,write:false},tx=>tx.selected(command.payload.id));
 const changed=foreign.filter(line=>{const previous=old?.data.lines.find(v=>v.id===line.id);return !previous||key(previous.resourceId??{},previous)!==key(line.resourceId,line);});if(!changed.length)return null;
 if(!sourceAccess)throw new AppError('MODULE_REFERENCE');const access=await sourceAccess(workspaceId,{signal}),witnesses=new Set();
 try{
  for(const line of changed){const ref=line.resourceId;await access.useOwner(ref.workspaceId,async(source,_owner,auth)=>inventoryOwnerTransaction(source,ref.workspaceId,'inventory',{check:auth.check,signal,write:false},async tx=>{const entity=await tx.selected(ref.id),book=await tx.book();requireValue(entity?.type==='resource'&&entity.data.kind==='material'&&entity.data.unit===line.unit,'Choose a material with the same unit');requireValue(line.sourceProjectId===null||book.projects.some(v=>v.id===line.sourceProjectId),'Choose an existing stock placement');witnesses.add(key(ref,line));}));}
  return {validate:async(ref,fields)=>{if(!witnesses.has(key(ref,fields)))throw new AppError('MODULE_REFERENCE');},verify:()=>access.verify(),close:()=>access.close()};
 }catch(error){try{await access.close();}catch{}throw error;}
}
