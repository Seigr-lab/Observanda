import {withScratch} from '../scratch-work.js';
import {add,negate,compare} from '../web/modules/quantities.js';
import {requiredQuantity,localBOMResource} from '../web/modules/bom-model.js';
import {validateExternalBOMStock,validateManagedReservationLedger} from './bom-integrity.js';
import {requireValue} from './validation.js';
export const bomConstraintTypes=['bom','movement','reservation'];
export async function validateBOMSource(source){
 await withScratch(async work=>{
  const targets=source.changes&&new Set(),reservations=source.changes&&new Set();
  if(source.changes){
   for(const entity of source.changes.values()){
    if(entity.type==='bom')targets.add(entity.id);
    if(entity.type==='reservation'){
     const old=await source.previous(entity.id);
     if(old)reservations.add(entity.id);
     if(old?.data.managed||entity.data.managed){
      const before=old?.data.managed,after=entity.data.managed;
      requireValue(!old||before&&after,'Managed reservation binding is fixed');
      if(before){
       const {settlement:previous,...binding}=before,{settlement:next,...nextBinding}=after;
       requireValue(['resourceId','projectId','quantity','unit'].every(key=>old.data[key]===entity.data[key]),'Managed reservation stock identity is fixed');
       requireValue(JSON.stringify(binding)===JSON.stringify(nextBinding)&&(!previous||JSON.stringify(previous)===JSON.stringify(next)),'Managed reservation evidence is fixed');
       requireValue(old.data.status==='active'||old.data.status===entity.data.status,'Managed reservation is already settled');
      }
     }
    }
    if(entity.type==='movement'&&entity.data.reservationId)reservations.add(entity.data.reservationId);
   }
   const managed=[...source.changes.values()].some(entity=>entity.type==='reservation'&&entity.data.managed);
   if(!reservations.size&&!managed){
    const changed=[...source.changes.values()].filter(entity=>entity.type==='bom');
    if(changed.every(entity=>entity.data.externalStock||entity.data.allocations.length===0)){
     for(const entity of changed)validateExternalBOMStock(entity.data,source.workspaceId,entity.id);
     return;
    }
   }
  }
  for await(const {data:d} of source.all('movement'))if(d.reservationId)await work.put(d.reservationId,add(await work.get(d.reservationId)??'0',negate(d.delta)));
  for await(const reservation of source.all('reservation'))if(reservation.data.managed&&(!reservations||reservations.has(reservation.id)||source.changes.has(reservation.id))){
   validateManagedReservationLedger(reservation,await source.get(reservation.data.resourceId),await work.get(reservation.id)??'0');
  }
  for await(const b of source.all('bom'))if(!targets||targets.has(b.id)||b.data.allocations.some(a=>(!a.workspaceId||a.workspaceId===source.workspaceId)&&reservations.has(a.reservationId))){
   validateExternalBOMStock(b.data,source.workspaceId,b.id);if(b.data.externalStock)continue;
   for(const allocation of b.data.allocations){
    const line=b.data.lines.find(l=>l.id===allocation.lineId),r=await source.get(allocation.reservationId);
    requireValue(line&&r?.type==='reservation'&&!r.data.managed&&r.data.resourceId===localBOMResource(line,source.workspaceId)&&r.data.projectId===line.sourceProjectId&&r.data.unit===line.unit
     &&compare(r.data.quantity,requiredQuantity(b.data,line))===0&&r.data.links.some(l=>l.type==='bom'&&l.id===b.id)
     &&(b.data.status==='reserved'?r.data.status==='active':r.data.status!=='active'),'BOM reservation integrity');
    const total=await work.get(r.id)??'0',usage=b.data.usage.find(u=>u.lineId===line.id);
    requireValue(compare(total,usage?add(usage.used,usage.scrapped):'0')===0,'BOM usage integrity');
   }
  }
 });
}
