import {AppError} from '../errors.js';
import {ModuleReader} from './reader.js';
import {uuid} from './validation.js';
import {inventoryQuantities,sumInventoryRows} from './inventory-query.js';
import {inventoryLocation,inventoryOwner} from '../web/modules/inventory-model.js';
import {discoveryMatches} from '../web/data-discovery.js';
const types=['resource','category','movement','reservation','stock-transfer','asset-transfer','bom'];
export class InventoryReader{
 constructor(workspace,{reader=new ModuleReader(workspace)}={}){this.reader=reader;}
 async stock({workspaceId,ids,scopeIds=null},{signal}={}){
  if(!Array.isArray(ids)||ids.length>25||new Set(ids).size!==ids.length||!ids.every(uuid)||scopeIds!==null&&(!Array.isArray(scopeIds)||scopeIds.length>10000||!scopeIds.every(id=>id===null||uuid(id))))throw new AppError('INVALID');
  return this.reader.context(workspaceId,async c=>({workspaceId,revision:c.head.revision,items:[...(await inventoryQuantities(c,ids,{signal,scope:scopeIds&&new Set(scopeIds)})).values()]}));
 }
 async page(command,{signal}={}){
  if(!types.includes(command.type))throw new AppError('INVALID');
  const page=await this.reader.list({...command,moduleId:'resources'},{signal});
  return this.reader.context(command.workspaceId,async c=>{
   if(c.head.revision!==page.revision)throw new AppError('MODULE_QUERY_CURSOR');
   return {...page,items:await this.present(c,page.items,{type:command.type,scopeIds:command.scopeIds,signal})};
  });
 }
 async present(c,summaries,{type,scopeIds,signal}={}){
   const stock=type==='resource'?await inventoryQuantities(c,summaries.map(i=>i.id),{signal,scope:scopeIds&&new Set(scopeIds)}):null,items=[];
   const scope=scopeIds&&new Set(scopeIds);
   for(const summary of summaries){
    signal?.throwIfAborted();const entity=await c.selected(summary.id);if(!entity)throw new AppError('CATALOGUE_DAMAGED');this.reader.modules.validateEntity(entity);
    const resource=entity.data.resourceId&&await c.member(entity.data.resourceId),resourceView=resource&&await c.view(resource);
    const data={...entity.data,owner:inventoryOwner(c.book,entity.data.projectId??resourceView?.projectId),revision:entity.revision,updatedAt:entity.updatedAt,...(resourceView?{resource:resourceView.title}:{})};
    const item={key:entity.id,title:summary.title,data,action:{name:'module-open',data:{moduleId:'resources',modulePath:summary.openType+'/'+summary.openId}}};
    if(stock){
     const all=stock.get(entity.id).locations,locations=scope?[...scope].map(projectId=>all.find(row=>row.projectId===projectId)??{projectId,physical:'0',reserved:'0',available:'0',used:'0',scrapped:'0',builds:0}):all;
     item.holdings=locations.map(row=>({...row,label:inventoryLocation(c.book,row.projectId)}));
     const counts=new Map();for(const row of item.holdings)counts.set(row.label,(counts.get(row.label)??0)+1);
     for(const row of item.holdings)if(counts.get(row.label)>1)row.label+=' ['+(row.projectId??'workspace')+']';
     Object.assign(data,sumInventoryRows(locations),stock.get(entity.id).usage,{unit:data.unit||'Items'});
    }
    items.push(item);
   }
   return items;
 }
 async ledger({workspaceId,resourceId,kind='movements',cursor=null,limit=25},{signal}={}){
  if(!uuid(resourceId)||!['movements','reservations'].includes(kind))throw new AppError('INVALID');
  const page=await this.reader.list({workspaceId,resourceId,types:kind==='movements'?['movement','stock-transfer','asset-transfer']:['reservation'],sort:'created-desc',cursor,limit},{signal});
  return this.reader.context(workspaceId,async c=>{
   if(c.head.revision!==page.revision)throw new AppError('MODULE_QUERY_CURSOR');
   const items=[];
   for(const summary of page.items){signal?.throwIfAborted();const entity=await c.selected(summary.id);if(!entity)throw new AppError('CATALOGUE_DAMAGED');this.reader.modules.validateEntity(entity);items.push(entity);}
   const managed=new Set();if(kind==='reservations')for await(const member of c.members({signal})){
    signal?.throwIfAborted();if(member.type&&member.type!=='bom')continue;
    const facts=await c.constraint(member);if(facts.type==='bom')for(const allocation of facts.data.allocations)if(items.some(i=>i.id===allocation.reservationId))managed.add(allocation.reservationId);
   }
   return {...page,items,managed:[...managed]};
  });
 }
 async discover({workspaceId,type,search='',offset=0,limit=12},{signal}={}){
  if(!types.includes(type)||typeof search!=='string'||search.length>256||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>25)throw new AppError('INVALID');
  return this.reader.context(workspaceId,async c=>{
   const items=[];let total=0;
   for await(const member of c.members({signal})){
    signal?.throwIfAborted();if(member.type&&member.type!==type)continue;const view=await c.view(member);if(view.type!==type)continue;
    const item={key:view.id,title:view.title,subtitle:inventoryOwner(c.book,view.projectId)};if(!discoveryMatches(item,search))continue;
    if(total++>=offset&&items.length<limit)items.push(item);
   }
   return {workspaceId,revision:c.head.revision,items,total,offset};
  });
 }
}
