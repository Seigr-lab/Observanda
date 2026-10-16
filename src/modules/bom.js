import {validBOMSource,verifyBOMSource} from '../bom-import.js';
import {randomUUID} from 'node:crypto';
import {exact,text,uuid,unique,linksValid,requireValue,saved} from './validation.js';
import {decimal,add,compare,negate} from '../web/modules/quantities.js';
import {requiredQuantity,validBOMResource,bomResourceReference,localBOMResource} from '../web/modules/bom-model.js';
import {validateExternalBOMStock} from './bom-integrity.js';
import {resourceDefinitions} from './resources.js';
import {bomConstraintTypes,validateBOMSource} from './bom-constraints.js';

const positive=value=>decimal(value)&&compare(value,'0')>0;
const nonnegative=value=>decimal(value)&&compare(value,'0')>=0;
const revision=value=>value===null||typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const activeLines=bom=>bom.lines.filter(line=>!line.dnp);
export function validateBOM(d){
 requireValue(exact(d,['title','projectId','recordId','recordTitle','recordRevision','designRevision','buildCount','notes','lines','status','allocations','usage','links',...(Object.hasOwn(d,'source')?['source']:[]),...(Object.hasOwn(d,'externalStock')?['externalStock']:[])])
  &&text(d.title,240,true)&&uuid(d.projectId)&&uuid(d.recordId)&&text(d.recordTitle,180,true)&&revision(d.recordRevision)&&d.recordRevision!==null
  &&text(d.designRevision,240)&&typeof d.buildCount==='string'&&/^[1-9]\d{0,5}$/.test(d.buildCount)&&text(d.notes,10000)
  &&['draft','reserved','finished','cancelled'].includes(d.status)&&Array.isArray(d.lines)&&d.lines.length>0&&d.lines.length<=200&&unique(d.lines.map(l=>l?.id))
  &&Array.isArray(d.allocations)&&Array.isArray(d.usage)&&linksValid(d.links),'Bill of materials');
 for(const line of d.lines){
  requireValue(exact(line,['id','references','value','footprint','partNumber','quantity','unit','resourceId','sourceProjectId','dnp','notes'])
   &&uuid(line.id)&&text(line.references,500)&&text(line.value,240,true)&&text(line.footprint,240)&&text(line.partNumber,240)
   &&positive(line.quantity)&&text(line.unit,80,true)&&validBOMResource(line.resourceId)
   &&(line.sourceProjectId===null||uuid(line.sourceProjectId))&&typeof line.dnp==='boolean'&&text(line.notes,2000),'BOM line');
  try{requireValue(decimal(requiredQuantity(d,line)),'BOM total quantity');}catch{requireValue(false,'BOM total quantity exceeds supported precision');}
 }
 requireValue(!Object.hasOwn(d,'source')||d.source===null||validBOMSource(d.source),'BOM original source');
 const references=d.lines.flatMap(l=>l.references.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean));
 requireValue(unique(references),'Each reference designator can appear only once; use comma-separated references');
 requireValue(d.allocations.every(a=>exact(a,['lineId','reservationId',...(Object.hasOwn(d,'externalStock')?['workspaceId']:[])])&&uuid(a.lineId)&&uuid(a.reservationId))
  &&unique(d.allocations.map(a=>a.lineId))&&unique(d.allocations.map(a=>Object.hasOwn(d,'externalStock')?JSON.stringify([a.workspaceId,a.reservationId]):a.reservationId)),'BOM reservations');
 requireValue(d.usage.every(u=>exact(u,['lineId','used','scrapped'])&&uuid(u.lineId)&&nonnegative(u.used)&&nonnegative(u.scrapped))
  &&unique(d.usage.map(u=>u.lineId)),'BOM actual usage');
 const lines=activeLines(d);
 requireValue(d.status==='draft'?d.allocations.length===0&&d.usage.length===0:
  d.allocations.length===lines.length&&lines.every(l=>l.resourceId&&d.allocations.some(a=>a.lineId===l.id)),'BOM allocation state');
 requireValue(d.status==='finished'?d.usage.length===lines.length&&lines.every(l=>{
  const usage=d.usage.find(u=>u.lineId===l.id);return usage&&compare(add(usage.used,usage.scrapped),requiredQuantity(d,l))<=0;
 }):d.usage.length===0,'Actual use and scrap must not exceed reserved quantities');
 validateExternalBOMStock(d);
}
function bom(tx,p,status){
 requireValue(uuid(p.id),'BOM identity');const e=tx.get(p.id);
 requireValue(e?.type==='bom'&&e.data.status===status,'This BOM is no longer '+status);tx.expect(e.id,p.expectedRevision);return e;
}
const links=(tx,e)=>[{workspaceId:tx.book.id,type:'record',id:e.data.recordId},{workspaceId:tx.book.id,type:'bom',id:e.id}];
export const bomDefinitions={
 constraintTypes:bomConstraintTypes,validateSource:validateBOMSource,
 types:{bom:validateBOM},
 validate:[(entities,{workspaceId}={})=>{
  for(const b of entities.filter(e=>e.type==='bom')){
   validateExternalBOMStock(b.data,workspaceId,b.id);if(b.data.externalStock)continue;
   for(const allocation of b.data.allocations){
   const line=b.data.lines.find(l=>l.id===allocation.lineId),r=entities.find(e=>e.id===allocation.reservationId);
   requireValue(r?.type==='reservation'&&!r.data.managed&&r.data.resourceId===localBOMResource(line,workspaceId)&&r.data.projectId===line.sourceProjectId&&r.data.unit===line.unit
    &&compare(r.data.quantity,requiredQuantity(b.data,line))===0&&r.data.links.some(l=>l.type==='bom'&&l.id===b.id)
    &&(b.data.status==='reserved'?r.data.status==='active':r.data.status!=='active'),'BOM reservation integrity');
   const movements=entities.filter(e=>e.type==='movement'&&e.data.reservationId===r.id);
   const total=movements.reduce((sum,e)=>add(sum,negate(e.data.delta)),'0'),usage=b.data.usage.find(u=>u.lineId===line.id);
   requireValue(compare(total,usage?add(usage.used,usage.scrapped):'0')===0,'BOM usage integrity');
   }
  }
 }],
 commands:{
  async 'bom.save'(tx,p){
   const old=saved(tx,p,'bom');
   requireValue((!old||old.data.status==='draft')&&p.data.status==='draft'&&p.data.allocations?.length===0&&p.data.usage?.length===0,'Reserved and completed BOMs are fixed; duplicate one for a new build');
   const record=await tx.recordSummary(p.data.recordId),notebook=tx.book.notebooks.find(n=>n.id===record?.notebookId);
   requireValue(record&&notebook,'Choose a saved record for this BOM');
   const data={...p.data,projectId:notebook.projectId,recordTitle:record.title,recordRevision:record.revision,links:[{workspaceId:tx.book.id,type:'record',id:record.id}]};
   validateBOM(data);
   if(old?.data.source)requireValue(JSON.stringify(old.data.source)===JSON.stringify(data.source),'The original BOM source is fixed; create a new BOM for a different source');
   else if(data.source)await verifyBOMSource(tx.workspace,data.source);
   for(const line of data.lines){
    const reference=bomResourceReference(line,tx.book.id),local=localBOMResource(line,tx.book.id);
    if(reference&&!local){
     const previous=old?.data.lines.find(value=>value.id===line.id),retained=previous&&bomResourceReference(previous,tx.book.id);
     const unchanged=retained&&retained.workspaceId===reference.workspaceId&&retained.id===reference.id&&previous.unit===line.unit&&previous.sourceProjectId===line.sourceProjectId;
     if(!unchanged){requireValue(!!tx.bomResources,'Choose an authorized inventory owner','MODULE_REFERENCE');await tx.bomResources.validate(reference,{unit:line.unit,sourceProjectId:line.sourceProjectId});}
    }else{
     if(local){const r=tx.get(local);requireValue(r?.type==='resource'&&r.data.kind==='material'&&r.data.unit===line.unit,'Choose a material stock item with the same unit');}
     requireValue(line.sourceProjectId===null||tx.book.projects.some(p=>p.id===line.sourceProjectId),'Choose an existing stock source');
    }
   }
   tx.put('bom',p.id,data);
  },
  async 'bom.reserve'(tx,p){
   requireValue(exact(p,['id','expectedRevision','resources'])&&Array.isArray(p.resources)&&p.resources.every(r=>exact(r,['id','revision'])&&uuid(r.id)&&Number.isSafeInteger(r.revision))&&unique(p.resources.map(r=>r.id)),'BOM reservation request');
   const e=bom(tx,p,'draft'),d=e.data,lines=activeLines(d),record=await tx.recordSummary(d.recordId);
   requireValue(lines.every(line=>line.resourceId===null||typeof line.resourceId==='string'),'Use the addressed BOM operation','MODULE_REFERENCE');
   requireValue(record&&record.revision===d.recordRevision,'The linked record changed. Review and save the BOM before reserving stock.');
   requireValue(lines.length>0&&lines.every(l=>l.resourceId),'Link every populated line to an inventory item; DNP lines do not reserve stock');
   const ids=[...new Set(lines.map(l=>l.resourceId))];requireValue(ids.length===p.resources.length&&ids.every(id=>p.resources.some(r=>r.id===id)),'Review the inventory items before reserving');
   for(const r of p.resources)tx.expect(r.id,r.revision);
   // The existing stock owner validates available quantities and status. All
   // lines share one module transaction, including rollback and replay receipts.
   const allocations=[];
   for(const line of lines){
    const r=tx.get(line.resourceId);requireValue(r?.type==='resource'&&r.data.kind==='material'&&r.data.unit===line.unit,'Stock item or unit changed; review the BOM');
    const reservation=await resourceDefinitions.commands['stock.reserve'](tx,{resourceId:r.id,expectedRevision:r.revision,projectId:line.sourceProjectId,quantity:requiredQuantity(d,line),reason:'BOM: '+d.title+' / '+(line.references||line.value),links:links(tx,e)});
    allocations.push({lineId:line.id,reservationId:reservation.id});
   }
   tx.put('bom',e.id,{...d,status:'reserved',allocations});
  },
  'bom.finish'(tx,p){
   requireValue(exact(p,['id','expectedRevision','usage']),'BOM completion request');const e=bom(tx,p,'reserved');requireValue(!e.data.externalStock,'Use the managed BOM operation','MODULE_REFERENCE');const next={...e.data,status:'finished',usage:p.usage};validateBOM(next);
   for(const allocation of e.data.allocations){
    const reservation=tx.get(allocation.reservationId),line=e.data.lines.find(l=>l.id===allocation.lineId),usage=p.usage.find(u=>u.lineId===line.id),r=tx.get(line.resourceId),total=add(usage.used,usage.scrapped);
    requireValue(reservation?.data.status==='active','The reserved stock changed');
    if(compare(total,'0')>0)requireValue(r.data.status==='available','Release held stock before recording its use','STOCK_UNAVAILABLE');
    const status=compare(total,'0')===0?'released':compare(total,reservation.data.quantity)===0?'consumed':'settled';
    tx.put('reservation',reservation.id,{...reservation.data,status});
    for(const [key,label] of [['used','Used'],['scrapped','Scrapped']])if(compare(usage[key],'0')>0)
     tx.put('movement',randomUUID(),{resourceId:r.id,projectId:line.sourceProjectId,delta:negate(usage[key]),unit:line.unit,reason:label+' in BOM: '+e.data.title+' / '+(line.references||line.value),links:links(tx,e),reservationId:reservation.id});
    tx.put('resource',r.id,r.data);
   }
   tx.put('bom',e.id,next);
  },
  'bom.cancel'(tx,p){
   requireValue(exact(p,['id','expectedRevision']),'BOM cancellation request');const e=bom(tx,p,'reserved');requireValue(!e.data.externalStock,'Use the managed BOM operation','MODULE_REFERENCE');
   for(const a of e.data.allocations){const r=tx.get(a.reservationId);requireValue(r?.data.status==='active','The reserved stock changed');tx.put('reservation',r.id,{...r.data,status:'released'});const item=tx.get(r.data.resourceId);tx.put('resource',item.id,item.data);}
   tx.put('bom',e.id,{...e.data,status:'cancelled'});
  }
 }
};
