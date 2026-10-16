import {exact,uuid,text,unique,requireValue} from './validation.js';
import {decimal,add,compare} from '../web/modules/quantities.js';
import {bomResourceReference,requiredQuantity} from '../web/modules/bom-model.js';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const nonnegative=value=>decimal(value)&&compare(value,'0')>=0;
const bomReference=value=>exact(value,['workspaceId','type','id'])&&uuid(value.workspaceId)&&value.type==='bom'&&uuid(value.id);
const sameReference=(a,b)=>a?.workspaceId===b?.workspaceId&&a?.type===b?.type&&a?.id===b?.id;
const optional=(value,key)=>Object.hasOwn(value,key)?[key]:[];

// Receipts contain only the stock effect and its immutable source event
// identity. Authentication of the original source event belongs to the source
// operation store; copied BOMs validate their retained evidence locally.
export function validateBOMReceipt(receipt){
 requireValue(exact(receipt,['version','operationId','action','sourceWorkspaceId','bom','planHash','decisionHash','lines','event'])&&receipt.version===1&&uuid(receipt.operationId)&&['reserve','finish','cancel'].includes(receipt.action)&&uuid(receipt.sourceWorkspaceId)&&bomReference(receipt.bom)&&hash(receipt.planHash)&&hash(receipt.decisionHash),'BOM stock receipt');
 requireValue(exact(receipt.event,['commandId','id','ordinal','hash'])&&uuid(receipt.event.commandId)&&uuid(receipt.event.id)&&Number.isSafeInteger(receipt.event.ordinal)&&receipt.event.ordinal>0&&hash(receipt.event.hash),'BOM stock event');
 requireValue(Array.isArray(receipt.lines)&&receipt.lines.length>0&&receipt.lines.length<=200&&unique(receipt.lines.map(line=>line?.lineId))&&unique(receipt.lines.map(line=>line?.reservationId)),'BOM stock receipt lines');
 for(const line of receipt.lines){
  requireValue(exact(line,['lineId','resourceId','sourceProjectId','reservationId','quantity','unit','used','scrapped'])&&uuid(line.lineId)&&uuid(line.resourceId)&&(line.sourceProjectId===null||uuid(line.sourceProjectId))&&uuid(line.reservationId)&&decimal(line.quantity)&&compare(line.quantity,'0')>0&&text(line.unit,80,true)&&nonnegative(line.used)&&nonnegative(line.scrapped),'BOM stock receipt quantity');
  const used=add(line.used,line.scrapped);
  requireValue(compare(used,line.quantity)<=0&&(receipt.action==='finish'||compare(used,'0')===0),'BOM stock receipt usage');
 }
 return receipt;
}

export function validateManagedReservation(data){
 if(!Object.hasOwn(data,'managed'))return data;
 const managed=data.managed;
 requireValue(exact(managed,['version','bom','operationId','lineId','planHash',...optional(managed??{},'settlement')])&&managed.version===1&&bomReference(managed.bom)&&uuid(managed.operationId)&&uuid(managed.lineId)&&hash(managed.planHash),'Managed BOM reservation');
 requireValue(Array.isArray(data.links)&&data.links.some(link=>sameReference(link,managed.bom)),'Managed BOM reservation link');
 if(!Object.hasOwn(managed,'settlement')){requireValue(['active','released'].includes(data.status),'Managed BOM reservation state');return data;}
 const settlement=managed.settlement;
 requireValue(exact(settlement,['operationId','action','decisionHash','used','scrapped'])&&uuid(settlement.operationId)&&settlement.operationId!==managed.operationId&&['finish','cancel'].includes(settlement.action)&&hash(settlement.decisionHash)&&nonnegative(settlement.used)&&nonnegative(settlement.scrapped),'Managed BOM settlement');
 const total=add(settlement.used,settlement.scrapped);
 requireValue(compare(total,data.quantity)<=0&&(settlement.action==='finish'||compare(total,'0')===0),'Managed BOM settlement quantity');
 const status=compare(total,'0')===0?'released':compare(total,data.quantity)===0?'consumed':'settled';
 requireValue(data.status===status,'Managed BOM settlement state');
 return data;
}

export function validateExternalBOMStock(data,workspaceId,bomId){
 if(!Object.hasOwn(data,'externalStock')){
  requireValue(data.allocations.every(allocation=>!Object.hasOwn(allocation,'workspaceId')),'BOM allocation owner');return data;
 }
 const stock=data.externalStock;
 requireValue(exact(stock,['version','reservation','settlement'])&&stock.version===1&&['reserved','finished','cancelled'].includes(data.status),'BOM external stock state');
 const lines=data.lines.filter(line=>!line.dnp),allocations=new Map(data.allocations.map(allocation=>[allocation.lineId,allocation]));
 requireValue(data.allocations.every(allocation=>exact(allocation,['lineId','reservationId','workspaceId'])&&uuid(allocation.lineId)&&uuid(allocation.reservationId)&&uuid(allocation.workspaceId))&&allocations.size===lines.length&&unique(data.allocations.map(allocation=>JSON.stringify([allocation.workspaceId,allocation.reservationId]))),'BOM external allocations');
 let resultOwner=null;
 const verify=(operation,action)=>{
  requireValue(exact(operation,['operationId','receipts'])&&uuid(operation.operationId)&&Array.isArray(operation.receipts)&&operation.receipts.length>0&&operation.receipts.length<=32,'BOM retained operation');
  requireValue(unique(operation.receipts.map(receipt=>receipt?.sourceWorkspaceId)),'BOM receipt source coverage');
  const covered=new Map();let planHash=null,decisionHash=null;
  for(const receipt of operation.receipts){
   validateBOMReceipt(receipt);resultOwner??=receipt.bom;
   requireValue(receipt.operationId===operation.operationId&&receipt.action===action&&sameReference(resultOwner,receipt.bom)&&(!workspaceId||receipt.bom.workspaceId===workspaceId)&&(!bomId||receipt.bom.id===bomId),'BOM receipt operation identity');
   planHash??=receipt.planHash;decisionHash??=receipt.decisionHash;
   requireValue(receipt.planHash===planHash&&receipt.decisionHash===decisionHash,'BOM receipt decision');
   for(const value of receipt.lines){
    const line=lines.find(line=>line.id===value.lineId),allocation=allocations.get(value.lineId),reference=line&&bomResourceReference(line,workspaceId??resultOwner.workspaceId);
    requireValue(!covered.has(value.lineId)&&line&&allocation&&reference&&reference.workspaceId===receipt.sourceWorkspaceId&&reference.id===value.resourceId&&allocation.workspaceId===receipt.sourceWorkspaceId&&allocation.reservationId===value.reservationId&&line.sourceProjectId===value.sourceProjectId&&line.unit===value.unit&&compare(value.quantity,requiredQuantity(data,line))===0,'BOM receipt allocation coverage');
    const usage=data.usage.find(usage=>usage.lineId===line.id);
    requireValue(action!=='finish'||usage&&compare(usage.used,value.used)===0&&compare(usage.scrapped,value.scrapped)===0,'BOM receipt actual usage');covered.set(value.lineId,value);
   }
  }
  requireValue(covered.size===lines.length,'BOM receipt complete coverage');return covered;
 };
 const reserved=verify(stock.reservation,'reserve');
 requireValue(data.status==='reserved'?stock.settlement===null:stock.settlement!==null,'BOM settlement coverage');
 if(stock.settlement!==null){
  requireValue(stock.settlement.operationId!==stock.reservation.operationId,'BOM settlement operation');
  const settled=verify(stock.settlement,data.status==='finished'?'finish':'cancel');
  for(const [id,line] of settled){const original=reserved.get(id);requireValue(original&&original.reservationId===line.reservationId&&original.resourceId===line.resourceId&&original.sourceProjectId===line.sourceProjectId&&original.unit===line.unit&&compare(original.quantity,line.quantity)===0,'BOM settlement reservation');}
 }
 return data;
}

export function validateManagedReservationLedger(reservation,resource,used){
 const data=reservation.data;if(!data.managed)return;
 validateManagedReservation(data);
 requireValue(resource?.type==='resource'&&resource.data.kind==='material'&&resource.data.unit===data.unit&&(data.status!=='active'||resource.data.status==='available'),'Managed reservation resource');
 const settlement=data.managed.settlement;
 requireValue(compare(used,settlement?add(settlement.used,settlement.scrapped):'0')===0,'Managed reservation usage integrity');
}
