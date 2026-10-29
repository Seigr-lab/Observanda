import {withScratch} from '../scratch-work.js';
import {localBOMResource} from '../web/modules/bom-model.js';
import {AppError} from '../errors.js';
import {add,negate} from '../web/modules/quantities.js';
import {stockTracked,assetPlacement} from '../web/modules/inventory-model.js';
import {mergeInventoryProjection,projectedInventoryScope} from './inventory-projection.js';

// Quantities are accumulated from authenticated constraint facts. Never infer
// a balance from the subset of ledger originals displayed on the current page.
export async function inventoryQuantities(context,ids,{signal,scope=null}={}){
 return withScratch(async work=>{
 const resources=new Map();
 for(const id of ids){
  signal?.throwIfAborted();const member=await context.member(id);
  if(!member||member.type&&member.type!=='resource')throw new AppError('NOT_FOUND');
  const entity=await context.constraint(member);if(entity.type!=='resource')throw new AppError('INVALID');
  resources.set(id,{id,revision:member.revision,data:{...entity.data,name:(await context.view(member)).title},usage:{used:'0',scrapped:'0',builds:0},locations:new Map()});
 }
 const row=(item,projectId)=>{
  if(!item.locations.has(projectId))item.locations.set(projectId,{projectId,physical:'0',reserved:'0',used:'0',scrapped:'0',builds:0});
  return item.locations.get(projectId);
 };
 for(const item of resources.values()){
  const value=row(item,stockTracked(item.data)?item.data.projectId??null:assetPlacement(item));
  if(!stockTracked(item.data))value.physical='1';
 }
 const plans=await context.stockProjection?.();
 if(plans)await mergeInventoryProjection(plans,resources,row,{work,scope,signal});
 else for await(const member of context.members({signal})){
  signal?.throwIfAborted();if(member.type&&!['movement','reservation','stock-transfer','bom'].includes(member.type))continue;
  const entity=await context.constraint(member),d=entity.data,item=resources.get(d.resourceId);
  if(item&&stockTracked(item.data)){
   if(entity.type==='stock-transfer'){
    const from=row(item,d.fromProjectId),to=row(item,d.toProjectId);from.physical=add(from.physical,negate(d.quantity));to.physical=add(to.physical,d.quantity);
   }else if(['movement','reservation'].includes(entity.type)){
    const value=row(item,Object.hasOwn(d,'projectId')?d.projectId:item.data.projectId??null);
    if(entity.type==='movement')value.physical=add(value.physical,d.delta);
    else if(d.status==='active')value.reserved=add(value.reserved,d.quantity);
   }
  }
  if(entity.type==='reservation'&&d.managed?.settlement?.action==='finish'&&item){
   const used=d.managed.settlement,value=row(item,d.projectId),identity=JSON.stringify([d.managed.bom.workspaceId,d.managed.bom.id,item.id]);
   value.used=add(value.used,used.used);value.scrapped=add(value.scrapped,used.scrapped);
   if(await work.add('place:'+JSON.stringify([identity,d.projectId])))value.builds++;
   if(!scope||scope.has(d.projectId)){
    item.usage.used=add(item.usage.used,used.used);item.usage.scrapped=add(item.usage.scrapped,used.scrapped);
    if(await work.add('total:'+identity))item.usage.builds++;
   }
  }
  if(entity.type==='bom'&&d.status==='finished'&&!d.externalStock){
   const counted=new Set(),builds=new Set();
   for(const usage of d.usage){
    const line=d.lines.find(l=>l.id===usage.lineId),item=line&&resources.get(localBOMResource(line,context.head?.workspaceId??context.book?.id));if(!item)continue;
    const value=row(item,line.sourceProjectId);value.used=add(value.used,usage.used);value.scrapped=add(value.scrapped,usage.scrapped);
    if(!scope||scope.has(line.sourceProjectId)){item.usage.used=add(item.usage.used,usage.used);item.usage.scrapped=add(item.usage.scrapped,usage.scrapped);if(!builds.has(item.id)){builds.add(item.id);item.usage.builds++;}}
    const key=item.id+':'+line.sourceProjectId;if(!counted.has(key)){counted.add(key);value.builds++;}
   }
  }
 }
 return new Map([...resources].map(([id,item])=>[id,{...item,locations:[...item.locations.values()].map(value=>({...value,available:stockTracked(item.data)?add(value.physical,negate(value.reserved)):item.data.status==='available'?value.physical:'0'}))}]));
 },{signal});
}

// Scope membership includes recorded placements even when their current stock
// is zero. Ownership alone must not hide stock allocated to another project.
export async function inventoryScopeItems(context,scope,{signal}={}){
 if(!scope)return null;
 const plans=await context.stockProjection?.();if(plans)return projectedInventoryScope(plans,scope,{signal});
 const visible=new Set();
 for await(const member of context.members({signal})){
  signal?.throwIfAborted();if(member.type&&!['resource','movement','reservation','stock-transfer'].includes(member.type))continue;
  const entity=await context.constraint(member),d=entity.data;
  if(entity.type==='resource'){
   if(scope.has(stockTracked(d)?d.projectId??null:assetPlacement(entity)))visible.add(entity.id);
  }else if(entity.type==='stock-transfer'){
   if(scope.has(d.fromProjectId)||scope.has(d.toProjectId))visible.add(d.resourceId);
  }else if(['movement','reservation'].includes(entity.type)){
   if(Object.hasOwn(d,'projectId')){if(scope.has(d.projectId))visible.add(d.resourceId);}
   // Unassigned older facts follow ownership, covered by the resource above.
  }
 }
 return visible;
}

export function sumInventoryRows(rows){
 const sum={physical:'0',reserved:'0',available:'0',used:'0',scrapped:'0'};
 for(const row of rows)for(const key of Object.keys(sum))sum[key]=add(sum[key],row[key]);
 return sum;
}
