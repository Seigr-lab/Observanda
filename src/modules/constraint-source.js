import {moduleConstraint} from './constraints.js';
import {add,negate} from '../web/modules/quantities.js';
import {projectedStockBalance} from './inventory-projection.js';
// One transaction-scoped source for domain invariants. Lookups keep a small
// cache; scans release each fact. Authored bodies are owned by selected commands.
export function moduleConstraintSource(catalogue,head,changed=new Map(),{work,originals=new Map()}={}){
 const cache=new Map();let bytes=0;
 async function baseGet(id){
  if(originals.has(id))return originals.get(id)?moduleConstraint(originals.get(id)):null;
  if(cache.has(id)){const item=cache.get(id);cache.delete(id);cache.set(id,item);return item.value;}
  const member=await catalogue.member(head,id),value=member?await catalogue.constraint(head,member):null,size=Buffer.byteLength(JSON.stringify(value));
  if(size<=65536){while(cache.size>=128||bytes+size>1024*1024){const [key,item]=cache.entries().next().value;cache.delete(key);bytes-=item.size;}cache.set(id,{value,size});bytes+=size;}
  return value;
 }
 const get=async id=>changed.has(id)?moduleConstraint(changed.get(id)):baseGet(id);
 async function* scan(types=null,overlay=true){
  const accepts=type=>types===null||(Array.isArray(types)?types.includes(type):type===types);
  for await(const member of catalogue.members(head,{types})){
   if(overlay&&changed.has(member.id)||member.type&&!accepts(member.type))continue;
   const value=await catalogue.constraint(head,member);if(accepts(value.type))yield value;
  }
  if(overlay)for(const entity of changed.values())if(accepts(entity.type))yield moduleConstraint(entity);
 }
 const all=types=>scan(types);
 async function some(types,predicate){for await(const value of all(types))if(await predicate(value))return true;return false;}
 let balancesReady=false;
 const balanceKey=(id,place)=>'stock:'+JSON.stringify([id,place]);
 async function aggregate(value,emit){
  const {type,data:d}=value;if(!['movement','reservation','stock-transfer'].includes(type))return;
  if(type==='stock-transfer'){
   await emit(d.resourceId,d.fromProjectId,negate(d.quantity),'0');await emit(d.resourceId,d.toProjectId,d.quantity,'0');
  }else{
   const place=Object.hasOwn(d,'projectId')?d.projectId:(await baseGet(d.resourceId))?.data.projectId??null;
   await emit(d.resourceId,place,type==='movement'?d.delta:'0',type==='reservation'&&d.status==='active'?d.quantity:'0');
  }
 }
 async function balance(resourceId,projects=null){
  const plans=await catalogue.stockProjection?.(head);
  if(!plans&&!balancesReady){
   for await(const fact of scan(['movement','reservation','stock-transfer'],false))await aggregate(fact,async(id,place,physical,reserved)=>{
    for(const location of [place,'total']){const key=balanceKey(id,location),value=await work.get(key)??{physical:'0',reserved:'0'};
     await work.put(key,{physical:add(value.physical,physical),reserved:add(value.reserved,reserved)});
    }
   });balancesReady=true;
  }
  let physical='0',reserved='0';
  if(plans)({physical,reserved}=await projectedStockBalance(plans,resourceId,(await baseGet(resourceId))?.data.projectId??null,projects));
  else for(const place of projects??['total']){const value=await work.get(balanceKey(resourceId,place));if(value){physical=add(physical,value.physical);reserved=add(reserved,value.reserved);}}
  async function adjust(value,reverse){await aggregate(value,async(id,place,p,r)=>{if(id===resourceId&&(!projects||projects.has(place))){physical=add(physical,reverse?negate(p):p);reserved=add(reserved,reverse?negate(r):r);}});}
  for(const entity of changed.values())if(['movement','reservation','stock-transfer'].includes(entity.type)){
   const previous=await baseGet(entity.id);if(previous)await adjust(previous,true);await adjust(moduleConstraint(entity),false);
  }
  return {physical,reserved,available:add(physical,negate(reserved))};
 }
 return {workspaceId:head.workspaceId,get,all,some,balance,previous:baseGet,get changes(){return head.currentVersion===1&&changed.size?changed:null;},async has(type,id){return (await get(id))?.type===type;}};
}
