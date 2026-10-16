// Only schedule and source-admission facts belong in the calendar read model.
// Notes, task bodies, resource fields and connection credentials stay original.
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
export function calendarFacts(entity){
 const fields={calendar:['name','projectId','color','archived'],resource:['name','projectId'],
  task:['title','projectId','status','dueOn'],
  booking:['title','projectId','resourceId','startsAt','endsAt','timeZone','places','kind','status'],
  event:['title','calendarId','startsAt','endsAt','allDay','timeZone','location','status'],
  subscription:['enabled'],'calendar-connection':['enabled']}[entity.type];
 return fields?{id:entity.id,type:entity.type,data:pick(entity.data,fields)}:null;
}
