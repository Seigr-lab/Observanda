// Explicit command participants. Owning a UUID or following a link cannot
// silently add a writer. The command kernel still validates every input/link.
import {moduleDomain,moduleDomainOf} from './domains.js';
import {AppError} from '../errors.js';
const plans=new Map();
const add=(action,primary,read=[],write=[primary])=>plans.set(action,{primary,read,write});
for(const type of ['calculation','reaction','sheet','chemical','timeline-view','category','task','calendar','event','subscription','calendar-connection','lab-space','lab-entry'])add(type+'.save',moduleDomain(type));
for(const action of ['resource.create','stock.move','stock.reserve','stock.transfer','resource.assign'])add(action,'inventory');
add('resource.save','inventory',['equipment']);
add('stock.resolve','inventory',['bom']);
add('booking.save','equipment',['inventory']);
add('bom.save','bom',['inventory']);
for(const action of ['bom.reserve','bom.finish','bom.cancel'])add(action,'bom',[],['bom','inventory']);
export const moduleDomainCommands=Object.freeze([...plans.keys()].sort());
export function moduleCommandPlan(command){
 const plan=plans.get(command?.action);if(!plan)throw new AppError('MODULE_FORMAT');
 const write=new Set(plan.write),read=new Set(plan.read),payload=command.payload;
 // Previously retained unresolved links remain the kernel's responsibility;
 // planning does not broaden access to another project or guess its owner.
 for(const links of [payload?.links,payload?.data?.links])if(Array.isArray(links))for(const link of links){
  if(link?.workspaceId!==command.workspaceId)continue;
  const domain=moduleDomainOf(link.type);if(domain&&!write.has(domain))read.add(domain);
 }
 return {primary:plan.primary,read:[...read].filter(domain=>!write.has(domain)).sort(),write:[...write].sort()};
}
