// Only the facts consumed by cross-entity invariants belong here. Authored
// prose, spreadsheet cells, imported originals and field values stay in the
// selected entity. This is never an editable or complete entity response.
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
export function moduleConstraint(entity){
 const d=entity.data;let data={};
 switch(entity.type){
  case 'resource':data=pick(d,['code','kind','unit','projectId','placementId','capacity','categoryId','status']);break;
  case 'movement':data=pick(d,['resourceId','projectId','delta','unit','reservationId']);break;
  case 'reservation':data=pick(d,['resourceId','projectId','quantity','unit','status','links']);break;
  case 'stock-transfer':data=pick(d,['resourceId','fromProjectId','toProjectId','quantity','unit']);break;
  case 'asset-transfer':data=pick(d,['resourceId']);break;
  case 'task':data={...pick(d,['dependencies','status']),checklist:d.checklist.map(c=>({done:c.done})),...pick(d,['prerequisiteObservations'])};break;
  case 'booking':data=pick(d,['resourceId','status','kind','places','startsAt','endsAt']);break;
  case 'bom':data={...pick(d,['status','buildCount','allocations','usage']),lines:d.lines.map(line=>pick(line,['id','resourceId','sourceProjectId','unit','quantity','dnp']))};break;
  case 'lab-space':data={scope:{notebookIds:d.scope?.notebookIds??[]},sections:d.sections.map(s=>({id:s.id}))};break;
  case 'lab-entry':data=pick(d,['labId','sectionId']);break;
  case 'event':data=pick(d,['calendarId']);break;
  case 'subscription':case 'calendar-connection':data=pick(d,['enabled']);break;
 }
 return {id:entity.id,type:entity.type,data};
}

// Domain handlers remain synchronous over their declared read set. An
// undeclared original lookup fails rather than returning an incomplete object.
export async function moduleCommandOriginals(catalogue,head,command){
 const entities=new Map(),pending=new Set(),p=command.payload;
 const add=id=>{if(typeof id==='string'&&!entities.has(id))pending.add(id);};
 add(p.id);add(p.resourceId);
 for(const key of ['categoryId','calendarId','labId','resourceId'])add(p.data?.[key]);
 if(Array.isArray(p.data?.lines))for(const line of p.data.lines)add(line?.resourceId);
 if(Array.isArray(p.resources))for(const resource of p.resources)add(resource?.id);
 while(pending.size){
  const id=pending.values().next().value;pending.delete(id);
  const entity=await catalogue.selected(head,id);entities.set(id,entity);
  if(!entity)continue;
  if(entity.type==='bom'){
   for(const line of entity.data.lines)add(line.resourceId);
   for(const allocation of entity.data.allocations)add(allocation.reservationId);
  }
  if(entity.type==='reservation')add(entity.data.resourceId);
 }
 return entities;
}
