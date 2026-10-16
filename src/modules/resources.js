import {validResourceTags} from '../web/modules/resource-tags.js';
import {AppError} from '../errors.js';
import {stockTracked,assetPlacement,inventoryLocations} from '../web/modules/inventory-model.js';
import {ownedShape,checkOwner} from './ownership.js';
import {prose} from './validation.js';
import {randomUUID} from 'node:crypto';
import {exact,object,text,uuid,linksValid,linkCheck,requireValue,unique,saved} from './validation.js';
import {decimal,add,compare,negate,balance} from '../web/modules/quantities.js';
import {schemaValid,validateValues} from './fields.js';
import {resourceConstraintTypes,validateResourceSource} from './resource-constraints.js';
export function validateCategory(d){requireValue(exact(d,['name','description','fields','archived'])&&text(d.name,160,true)&&prose(d.description,10000)&&schemaValid(d.fields)&&typeof d.archived==='boolean','Category and field definitions');}
export function validateResource(d){
 if(d&&Object.hasOwn(d,'tags')&&!validResourceTags(d.tags))throw new AppError('RESOURCE_TAGS');
 requireValue(ownedShape(d,['name','code','kind','description','categoryId','schemaRevision','fieldSchema','values','location','unit','capacity','status','links',...(Object.hasOwn(d,'tags')?['tags']:[]),...(Object.hasOwn(d,'placementId')?['placementId']:[])])&&text(d.name,240,true)&&text(d.code,160)&&['object','material','equipment','software'].includes(d.kind)&&prose(d.description,100000)&&text(d.location,500)&&text(d.unit,80,stockTracked(d))&&Number.isSafeInteger(d.capacity)&&d.capacity>0&&['available','hold','retired'].includes(d.status)&&linksValid(d.links)&&schemaValid(d.fieldSchema)&&object(d.values)&&(!Object.hasOwn(d,'placementId')||d.placementId===null||uuid(d.placementId)),'Resource details');
 requireValue(d.categoryId===null?d.schemaRevision===null&&!d.fieldSchema.length:uuid(d.categoryId)&&Number.isSafeInteger(d.schemaRevision)&&d.schemaRevision>0,'Resource category');
 validateValues(d.fieldSchema,d.values);
}
function validateMovement(d){requireValue(ownedShape(d,['resourceId','delta','unit','reason','links','reservationId'])&&uuid(d.resourceId)&&decimal(d.delta)&&compare(d.delta,'0')!==0&&text(d.unit,80,true)&&text(d.reason,2000,true)&&linksValid(d.links)&&(d.reservationId===null||uuid(d.reservationId)),'Stock movement');}
function validateReservation(d){requireValue(ownedShape(d,['resourceId','quantity','unit','reason','status','links'])&&uuid(d.resourceId)&&decimal(d.quantity)&&compare(d.quantity,'0')>0&&text(d.unit,80,true)&&text(d.reason,2000,true)&&['active','released','consumed','settled'].includes(d.status)&&linksValid(d.links),'Stock reservation');}
function validateTransfer(d){
 requireValue(exact(d,['resourceId','fromProjectId','toProjectId','quantity','unit','reason','links'])&&uuid(d.resourceId)&&[d.fromProjectId,d.toProjectId].every(id=>id===null||uuid(id))&&d.fromProjectId!==d.toProjectId&&decimal(d.quantity)&&compare(d.quantity,'0')>0&&text(d.unit,80,true)&&text(d.reason,2000,true)&&linksValid(d.links),'Stock transfer');
}
function validateAssignment(d){
 requireValue(exact(d,['resourceId','fromProjectId','toProjectId','reason','links'])&&uuid(d.resourceId)&&[d.fromProjectId,d.toProjectId].every(id=>id===null||uuid(id))&&d.fromProjectId!==d.toProjectId&&text(d.reason,2000,true)&&linksValid(d.links),'Item placement');
}
const hasPlace=p=>Object.hasOwn(p,'projectId');
const place=(r,p)=>hasPlace(p)?p.projectId:(r.data.projectId??null);
function checkPlace(tx,id){requireValue(id===null||uuid(id)&&tx.book.projects.some(p=>p.id===id),'Choose an existing inventory location','MODULE_REFERENCE');}
async function checkAvailable(tx,r,projectId,quantity){
 const b=await tx.balance(r.id,new Set([projectId]));
 requireValue(compare(b.available,quantity)>=0,'Not enough available stock at the selected location','STOCK_UNAVAILABLE');
}
export function validateResources(entities){
 const resources=entities.filter(e=>e.type==='resource'),codes=resources.filter(e=>e.data.code.trim()).map(e=>(e.data.projectId??'workspace')+':'+e.data.code.trim().toLowerCase());
 requireValue(unique(codes),'Resource codes must be unique within their owner location');
 for(const r of resources){
  const b=balance(entities,r.id);requireValue(compare(b.physical,'0')>=0&&compare(b.available,'0')>=0,'Stock balance','STOCK_UNAVAILABLE');
  for(const row of inventoryLocations(entities,r.id))requireValue(compare(row.physical,'0')>=0&&compare(row.available,'0')>=0,'A location cannot use or transfer more than its available stock','STOCK_UNAVAILABLE');
  if(r.data.categoryId)requireValue(entities.some(c=>c.id===r.data.categoryId&&c.type==='category'),'Resource category');
 }
 for(const e of entities.filter(e=>e.type==='asset-transfer'))requireValue(resources.some(r=>r.id===e.data.resourceId&&!stockTracked(r.data)),'Transferred individual item');
 for(const e of entities.filter(e=>['movement','reservation','stock-transfer'].includes(e.type))){
  const r=resources.find(r=>r.id===e.data.resourceId);requireValue(r&&stockTracked(r.data)&&r.data.unit===e.data.unit,'Stock resource and unit');
 }
}
function stockResource(tx,p){
 const r=tx.get(p.resourceId);requireValue(r?.type==='resource'&&stockTracked(r.data),'Stock item');
 tx.expect(r.id,p.expectedRevision);return r;
}
export const resourceDefinitions={
 types:{category:validateCategory,resource:validateResource,movement:validateMovement,reservation:validateReservation,'stock-transfer':validateTransfer,'asset-transfer':validateAssignment},
 validate:[validateResources],
 constraintTypes:resourceConstraintTypes,validateSource:validateResourceSource,
 commands:{
  async 'resource.create'(tx,p){
   requireValue(exact(p,['id','data','openingStock'])&&exact(p.openingStock,['quantity','projectId'])&&decimal(p.openingStock.quantity)&&compare(p.openingStock.quantity,'0')>=0,'Opening inventory');
   await resourceDefinitions.commands['resource.save'](tx,{id:p.id,expectedRevision:null,data:p.data});
   const r=tx.get(p.id);checkPlace(tx,p.openingStock.projectId);
   if(stockTracked(r.data)){
    if(compare(p.openingStock.quantity,'0')>0)await resourceDefinitions.commands['stock.move'](tx,{resourceId:r.id,expectedRevision:r.revision,projectId:p.openingStock.projectId,delta:p.openingStock.quantity,reason:'Opening stock',links:r.data.links});
   }else requireValue(compare(p.openingStock.quantity,'0')===0,'Individual items do not have an opening stock quantity');
  },
  'category.save'(tx,p){saved(tx,p,'category');validateCategory(p.data);tx.put('category',p.id,p.data);},
  async 'resource.save'(tx,p){
   const old=saved(tx,p,'resource'),d=p.data;validateResource(d);checkOwner(tx,d);if(Object.hasOwn(d,'placementId'))checkPlace(tx,d.placementId);
   if(old)requireValue(assetPlacement({data:d})===assetPlacement(old)||stockTracked(d),'Use Move item to change its placement');await linkCheck(tx,d.links,old?.data.links);
   if(d.categoryId&&(!old||old.data.categoryId!==d.categoryId||old.data.schemaRevision!==d.schemaRevision)){
    const c=tx.get(d.categoryId);requireValue(c?.type==='category'&&!c.data.archived&&c.revision===d.schemaRevision&&JSON.stringify(c.data.fields)===JSON.stringify(d.fieldSchema),'Reload the category before applying its fields','MODULE_REFERENCE');
   }else if(old)requireValue(JSON.stringify(d.fieldSchema)===JSON.stringify(old.data.fieldSchema),'Saved field schema');
   if(old&&await tx.some(['movement','reservation','stock-transfer'],e=>e.data.resourceId===p.id))requireValue(d.kind===old.data.kind&&d.unit===old.data.unit&&(d.projectId??null)===(old.data.projectId??null),'An item with stock history retains its owner, unit and kind; use Transfer stock to change its placement');
   if(old&&await tx.some('booking',e=>e.data.resourceId===p.id&&e.data.status==='confirmed'))requireValue(d.kind==='equipment','Booked equipment must remain equipment');
   tx.put('resource',p.id,d);
  },
  async 'stock.move'(tx,p){
   requireValue(exact(p,['resourceId','expectedRevision','delta','reason','links',...(hasPlace(p)?['projectId']:[])]),'Stock command');const r=stockResource(tx,p);
   requireValue(decimal(p.delta)&&compare(p.delta,'0')!==0,'Quantity');
   requireValue(r.data.status!=='retired'&&(compare(p.delta,'0')>0||r.data.status==='available'),'Release a held material before consuming it','STOCK_UNAVAILABLE');
   await linkCheck(tx,p.links);const projectId=place(r,p);checkPlace(tx,projectId);
   if(compare(p.delta,'0')<0)await checkAvailable(tx,r,projectId,negate(p.delta));
   tx.put('movement',randomUUID(),{resourceId:r.id,projectId,delta:add(p.delta,'0'),reason:p.reason,unit:r.data.unit,links:p.links,reservationId:null});tx.put('resource',r.id,r.data);
  },
  async 'stock.reserve'(tx,p){
   requireValue(exact(p,['resourceId','expectedRevision','quantity','reason','links',...(hasPlace(p)?['projectId']:[])]),'Reservation command');const r=stockResource(tx,p);
   requireValue(r.data.status==='available','Material is not available','STOCK_UNAVAILABLE');await linkCheck(tx,p.links);const projectId=place(r,p);checkPlace(tx,projectId);
   requireValue(decimal(p.quantity)&&compare(p.quantity,'0')>0,'Quantity');await checkAvailable(tx,r,projectId,p.quantity);
   const reservation=tx.put('reservation',randomUUID(),{resourceId:r.id,projectId,quantity:p.quantity,reason:p.reason,unit:r.data.unit,status:'active',links:p.links});tx.put('resource',r.id,r.data);return reservation;
  },
  async 'stock.transfer'(tx,p){
   requireValue(exact(p,['resourceId','expectedRevision','fromProjectId','toProjectId','quantity','reason','links']),'Transfer command');
   const r=stockResource(tx,p);checkPlace(tx,p.fromProjectId);checkPlace(tx,p.toProjectId);
   requireValue(r.data.status==='available','Item is not available','STOCK_UNAVAILABLE');
   const data={resourceId:r.id,fromProjectId:p.fromProjectId,toProjectId:p.toProjectId,quantity:p.quantity,unit:r.data.unit,reason:p.reason,links:p.links};
   validateTransfer(data);await linkCheck(tx,p.links);await checkAvailable(tx,r,p.fromProjectId,p.quantity);
   tx.put('stock-transfer',randomUUID(),data);tx.put('resource',r.id,r.data);
  },
  async 'resource.assign'(tx,p){
   requireValue(exact(p,['resourceId','expectedRevision','toProjectId','reason','links']),'Placement command');
   const r=tx.get(p.resourceId);requireValue(r?.type==='resource'&&!stockTracked(r.data),'Individual item');tx.expect(r.id,p.expectedRevision);
   checkPlace(tx,p.toProjectId);await linkCheck(tx,p.links);
   const data={resourceId:r.id,fromProjectId:assetPlacement(r),toProjectId:p.toProjectId,reason:p.reason,links:p.links};
   validateAssignment(data);tx.put('asset-transfer',randomUUID(),data);tx.put('resource',r.id,{...r.data,placementId:p.toProjectId});
  },
  async 'stock.resolve'(tx,p){
   requireValue(exact(p,['id','expectedRevision','decision'])&&['release','consume'].includes(p.decision),'Reservation command');const e=tx.get(p.id);
   requireValue(e?.type==='reservation'&&e.data.status==='active','Active reservation');tx.expect(e.id,p.expectedRevision);
   requireValue(!await tx.some('bom',b=>b.data.allocations.some(a=>a.reservationId===e.id)),'Use the linked BOM to record actual use or release its reservation');
   const r=tx.get(e.data.resourceId);
   if(p.decision==='consume'){
    requireValue(r.data.status==='available','Material is not available','STOCK_UNAVAILABLE');
    tx.put('movement',randomUUID(),{resourceId:r.id,projectId:place(r,e.data),delta:negate(e.data.quantity),unit:r.data.unit,reason:e.data.reason,links:e.data.links,reservationId:e.id});
   }
   tx.put('reservation',e.id,{...e.data,status:p.decision==='consume'?'consumed':'released'});tx.put('resource',r.id,r.data);
  }
 }
};
