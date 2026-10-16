import {withScratch} from '../scratch-work.js';
import {add,negate,compare} from '../web/modules/quantities.js';
import {requiredQuantity} from '../web/modules/bom-model.js';
import {requireValue} from './validation.js';
export const bomConstraintTypes=['bom','movement','reservation'];
export async function validateBOMSource(source){
 await withScratch(async work=>{
  const targets=source.changes&&new Set(),reservations=source.changes&&new Set();
  if(source.changes){
   for(const entity of source.changes.values()){
    if(entity.type==='bom')targets.add(entity.id);
    if(entity.type==='reservation'&&await source.previous(entity.id))reservations.add(entity.id);
    if(entity.type==='movement'&&entity.data.reservationId)reservations.add(entity.data.reservationId);
   }
   if(!targets.size&&!reservations.size)return;
  }
  for await(const {data:d} of source.all('movement'))if(d.reservationId)await work.put(d.reservationId,add(await work.get(d.reservationId)??'0',negate(d.delta)));
  for await(const b of source.all('bom'))if(!targets||targets.has(b.id)||b.data.allocations.some(a=>reservations.has(a.reservationId)))for(const allocation of b.data.allocations){
   const line=b.data.lines.find(l=>l.id===allocation.lineId),r=await source.get(allocation.reservationId);
   requireValue(line&&r?.type==='reservation'&&r.data.resourceId===line.resourceId&&r.data.projectId===line.sourceProjectId&&r.data.unit===line.unit
    &&compare(r.data.quantity,requiredQuantity(b.data,line))===0&&r.data.links.some(l=>l.type==='bom'&&l.id===b.id)
    &&(b.data.status==='reserved'?r.data.status==='active':r.data.status!=='active'),'BOM reservation integrity');
   const total=await work.get(r.id)??'0',usage=b.data.usage.find(u=>u.lineId===line.id);
   requireValue(compare(total,usage?add(usage.used,usage.scrapped):'0')===0,'BOM usage integrity');
  }
 });
}
