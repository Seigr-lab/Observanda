import {add,compare,multiply,balance} from './quantities.js';
export const bomLine=()=>({id:crypto.randomUUID(),references:'',value:'',footprint:'',partNumber:'',quantity:'1',unit:'items',resourceId:null,sourceProjectId:null,dnp:false,notes:''});
export const blankBOM=()=>({title:'',projectId:null,recordId:'',recordTitle:'',recordRevision:null,designRevision:'',buildCount:'1',notes:'',lines:[],status:'draft',allocations:[],usage:[],links:[]});
export const requiredQuantity=(bom,line)=>line.dnp?'0':multiply(line.quantity,bom.buildCount);
// Combine repeated inventory items at the same source before assessing stock.
// Different placements stay separate; central stock is never silently allocated.
export function bomRequirements(bom){
 const groups=new Map();
 for(const line of bom.lines.filter(line=>!line.dnp&&line.resourceId)){
  const key=JSON.stringify([line.resourceId,line.sourceProjectId]);
  const group=groups.get(key)??{resourceId:line.resourceId,projectId:line.sourceProjectId,quantity:'0'};
  group.quantity=add(group.quantity,requiredQuantity(bom,line));groups.set(key,group);
 }
 return [...groups.values()];
}
export function bomAvailability(bom,entities){
 return bomRequirements(bom).map(group=>{
  const item=entities.find(e=>e.id===group.resourceId),stock=balance(entities,group.resourceId,new Set([group.projectId]));
  return {...group,item,available:stock.available,shortage:compare(group.quantity,stock.available)>0?add(group.quantity,'-'+stock.available):'0'};
 });
}
