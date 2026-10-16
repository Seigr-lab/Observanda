import {add,compare,multiply,balance} from './quantities.js';
export const bomLine=()=>({id:crypto.randomUUID(),references:'',value:'',footprint:'',partNumber:'',quantity:'1',unit:'items',resourceId:null,sourceProjectId:null,dnp:false,notes:''});
export const blankBOM=()=>({title:'',projectId:null,recordId:'',recordTitle:'',recordRevision:null,designRevision:'',buildCount:'1',notes:'',lines:[],status:'draft',allocations:[],usage:[],links:[]});
export const requiredQuantity=(bom,line)=>line.dnp?'0':multiply(line.quantity,bom.buildCount);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const validBOMResource=value=>value===null||uuid(value)||value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3&&['workspaceId','type','id'].every(key=>Object.hasOwn(value,key))&&uuid(value.workspaceId)&&value.type==='resource'&&uuid(value.id);
export const bomResourceReference=(line,workspaceId)=>line?.resourceId==null?null:typeof line.resourceId==='string'?{workspaceId,type:'resource',id:line.resourceId}:{...line.resourceId};
export const bomResourceKey=reference=>JSON.stringify([reference.workspaceId,reference.type,reference.id]);
export const localBOMResource=(line,workspaceId)=>typeof line?.resourceId==='string'?line.resourceId:line?.resourceId&&typeof line.resourceId==='object'&&line.resourceId.workspaceId===workspaceId?line.resourceId.id:null;
export const addressedBOM=bom=>bom.lines.some(line=>line.resourceId!==null&&typeof line.resourceId==='object');
// Combine repeated inventory items at the same source before assessing stock.
// Different placements stay separate; central stock is never silently allocated.
export function bomRequirements(bom,workspaceId){
 const groups=new Map();
 for(const line of bom.lines.filter(line=>!line.dnp&&line.resourceId)){
  const reference=bomResourceReference(line,workspaceId),key=JSON.stringify([reference.workspaceId??null,reference.id,line.sourceProjectId]);
  const group=groups.get(key)??{resourceId:line.resourceId,projectId:line.sourceProjectId,quantity:'0'};
  group.quantity=add(group.quantity,requiredQuantity(bom,line));groups.set(key,group);
 }
 return [...groups.values()];
}
export function bomAvailability(bom,entities,workspaceId){
 return bomRequirements(bom,workspaceId).map(group=>{
  const id=localBOMResource(group,workspaceId);
  if(!id)return {...group,item:null,available:null,shortage:null,status:'unavailable'};
  const item=entities.find(e=>e.id===id),stock=balance(entities,id,new Set([group.projectId]));
  return {...group,item,available:stock.available,shortage:compare(group.quantity,stock.available)>0?add(group.quantity,'-'+stock.available):'0'};
 });
}
