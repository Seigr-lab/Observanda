import {AppError} from './errors.js';
import {exact,uuid,text,instant,unique} from './modules/validation.js';
import {observedResourceQuality,recordedResourceQuality,validObservedQuality} from './modules/resource-quality.js';
import {decimal,compare} from './web/modules/quantities.js';

const validRevision=v=>Number.isSafeInteger(v)&&v>0;
const invalid=()=>{throw new AppError('LAB_INVALID');};
const validSelection=item=>exact(item,['kind','id','revision'])&&['equipment','movement'].includes(item.kind)&&uuid(item.id)&&validRevision(item.revision);
export function validRunQuality(value){
 if(!exact(value,['version','workspaceId','at','items'])||value.version!==1||!uuid(value.workspaceId)||!instant(value.at)||
    !Array.isArray(value.items)||!value.items.length||value.items.length>64||!unique(value.items.map(item=>item?.id)))return false;
 return value.items.every(item=>{
  // Equipment starts new work and must pass its run rule; a posted lot use is recorded as it was, block included.
  if(!item||!uuid(item.id)||!validRevision(item.revision)||!validObservedQuality(item.readiness,item.readiness?.resourceId,{blocked:item.kind==='movement'})||
     item.readiness.workflow!=='run'||item.readiness.on!==value.at.slice(0,10))return false;
  if(item.kind==='equipment')return exact(item,['kind','id','revision','readiness'])&&item.readiness.quality.kind==='equipment'&&item.id===item.readiness.resourceId&&item.revision===item.readiness.resourceRevision;
  return item.kind==='movement'&&exact(item,['kind','id','revision','readiness','stockUse','unit','delta','status'])&&['available','hold'].includes(item.status)&&decimal(item.delta)&&compare(item.delta,'0')<0&&
   text(item.unit,80,true)&&validObservedQuality(item.stockUse,item.readiness.resourceId)&&item.stockUse.workflow==='use'&&
   item.stockUse.quality.kind==='lot'&&item.readiness.quality.kind==='lot'&&item.stockUse.quality.number===item.readiness.quality.number;
 });
}

// Inventory and samples have a common transaction and stable lock order.
// A run references the stock owner's actual posted usage; it never debits it again.
export async function observeRunQuality(store,namespace,inputs,now){
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>64||!inputs.every(validSelection)||!unique(inputs.map(item=>item.id)))invalid();
 const {ModuleCatalogue}=await import('./modules/catalogue.js');
 const inventory=new ModuleCatalogue(store),head=await inventory.head(namespace),items=[];
 for(const input of inputs){
  const selected=await inventory.selected(head,input.id);
  if(!selected||selected.revision!==input.revision)throw new AppError('MODULE_CHANGED');
  const equipment=input.kind==='equipment';
  if(equipment?selected.type!=='resource'||selected.data.quality?.kind!=='equipment':
     selected.type!=='movement'||selected.data.useKind!=='used'||!selected.data.qualityAtUse)invalid();
  const resource=equipment?selected:await inventory.selected(head,selected.data.resourceId);
  if(resource?.type!=='resource'||!resource.data.quality)invalid();
  // A hold stops new use and new bookings; a lot use already posted stays citable and records the hold.
  if(equipment?resource.data.status!=='available':!['available','hold'].includes(resource.data.status))throw new AppError(equipment?'BOOKING_UNAVAILABLE':'STOCK_UNAVAILABLE');
  const readiness=equipment?observedResourceQuality(resource,'run',now).qualityAtUse:recordedResourceQuality(resource,'run',now);
  items.push({...input,readiness,...(equipment?{}:{stockUse:selected.data.qualityAtUse,unit:selected.data.unit,delta:selected.data.delta,status:resource.data.status})});
 }
 const value={version:1,workspaceId:namespace,at:now,items};if(!validRunQuality(value))invalid();return value;
}
