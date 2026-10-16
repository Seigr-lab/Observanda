// Internal source phases. The coordinator supplies authenticated immutable intent/decision.
// No HTTP handler accepts these values or the source effect builders directly.
import {inventoryOwnerTransaction,inventoryPhaseId} from './inventory-operation-transaction.js';
import {inventoryOperationHash} from './inventory-operation-store.js';
import {add,compare,negate} from './web/modules/quantities.js';
import {requireValue} from './modules/validation.js';
import {AppError} from './errors.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bomRef=intent=>({workspaceId:intent.workspaceId,type:'bom',id:intent.bomId});
const participantIntent=(intent,p)=>({version:1,id:intent.id,role:'participant',workspaceId:p.workspaceId,bom:bomRef(intent),action:intent.action,planHash:inventoryOperationHash(intent),reservationOperationId:intent.reservationOperationId,lines:p.lines,at:intent.at});
const pointer=(id,operationId)=>({version:1,id,operationId});
const phaseCommand=(intent,namespace,phase)=>({workspaceId:namespace,commandId:inventoryPhaseId(intent.id,namespace,phase),action:'inventory.bom.'+phase,payload:{operationId:intent.id,planHash:inventoryOperationHash(intent)}});
function checkManaged(reservation,intent,line){
 const d=reservation?.data,m=d?.managed;
 requireValue(reservation?.type==='reservation'&&d.status==='active'&&m?.operationId===intent.reservationOperationId&&same(m.bom,bomRef(intent))&&m.lineId===line.lineId&&d.resourceId===line.resourceId&&d.projectId===line.sourceProjectId&&d.unit===line.unit&&compare(d.quantity,line.quantity)===0,'The managed reservation changed','MODULE_CHANGED');
}
export async function prepareInventoryParticipant(storage,namespace,intent,p,options){
 return inventoryOwnerTransaction(storage,namespace,'inventory',{...options,write:true,events:true},async tx=>{
  const {journal}=tx,plan=participantIntent(intent,p);await journal.once('intent',intent.id,plan);
  const terminal=await journal.read('receipt',intent.id);if(terminal)return {terminal:true,outcome:terminal.outcome};
  const retained=await journal.read('prepared',intent.id);if(retained)return retained;
  let evidence=null;
  if(intent.action==='reserve'){
   const book=await tx.book(),written=await tx.event(phaseCommand(intent,namespace,'prepare'),async({get,put,source})=>{
    for(const line of p.lines){const r=await get(line.resourceId);requireValue(r?.type==='resource'&&r.revision===line.resourceRevision,'The stock item changed','MODULE_CHANGED');requireValue(r.data.kind==='material'&&r.data.unit===line.unit&&r.data.status==='available','The selected material is unavailable','STOCK_UNAVAILABLE');requireValue(line.sourceProjectId===null||book.projects.some(v=>v.id===line.sourceProjectId),'The stock placement changed','MODULE_CHANGED');}
    for(const line of p.lines){
     const balance=await source.balance(line.resourceId,new Set([line.sourceProjectId]));requireValue(compare(balance.available,line.quantity)>=0,'The location has insufficient available stock','STOCK_UNAVAILABLE');
     if(await get(line.reservationId))throw new AppError('MODULE_CHANGED');
     await put('reservation',line.reservationId,{resourceId:line.resourceId,projectId:line.sourceProjectId,quantity:line.quantity,unit:line.unit,reason:'Reserved for linked bill of materials',status:'active',links:[bomRef(intent)],managed:{version:1,bom:bomRef(intent),operationId:intent.id,lineId:line.lineId,planHash:plan.planHash}});
     const resource=await get(line.resourceId);await put('resource',resource.id,resource.data);
    }
   });evidence=written.evidence;
   for(const line of p.lines)await journal.write('live',line.reservationId,pointer(line.reservationId,intent.id));
  }else{
   for(const line of p.lines){
    const reservation=await tx.selected(line.reservationId);checkManaged(reservation,intent,line);
    const claim=await journal.read('claim',line.reservationId);if(claim&&claim.operationId!==intent.id)throw new AppError('INVENTORY_OPERATION_BUSY');
    if(intent.action==='finish'&&compare(add(line.used,line.scrapped),'0')>0){const resource=await tx.selected(line.resourceId);requireValue(resource?.data.status==='available','The selected material is unavailable','STOCK_UNAVAILABLE');}
    await journal.write('claim',line.reservationId,pointer(line.reservationId,intent.id));
   }
  }
  const prepared={version:1,id:intent.id,planHash:plan.planHash,evidence};await journal.once('prepared',intent.id,prepared);await journal.write('pending',intent.id,pointer(intent.id,intent.id));return prepared;
 });
}
export async function applyInventoryParticipant(storage,namespace,intent,p,decision,options){
 const plan=participantIntent(intent,p);if(decision?.id!==intent.id||decision.planHash!==plan.planHash||!['commit','abort'].includes(decision.outcome))throw new AppError('INVALID');
 return inventoryOwnerTransaction(storage,namespace,'inventory',{...options,write:true,events:true},async tx=>{
  const {journal}=tx;await journal.once('intent',intent.id,plan);await journal.once('decision',intent.id,decision);const old=await journal.read('receipt',intent.id);if(old){if(old.outcome!==decision.outcome)throw new AppError('CATALOGUE_DAMAGED');return old;}
  const prepared=await journal.read('prepared',intent.id);if(decision.outcome==='commit'&&!prepared)throw new AppError('CATALOGUE_DAMAGED');let evidence=prepared?.evidence??null;
  if(prepared&&(intent.action==='reserve'&&decision.outcome==='abort'||intent.action!=='reserve'&&decision.outcome==='commit')){
   const written=await tx.event(phaseCommand(intent,namespace,decision.outcome),async({get,put})=>{
    for(const line of p.lines){
     const reservation=await get(line.reservationId),expected=intent.action==='reserve'?{...intent,reservationOperationId:intent.id}:intent;checkManaged(reservation,expected,line);
     if(intent.action!=='reserve'&&(await journal.read('claim',line.reservationId))?.operationId!==intent.id)throw new AppError('CATALOGUE_DAMAGED');
     const finishing=intent.action==='finish'&&decision.outcome==='commit',used=finishing?line.used:'0',scrapped=finishing?line.scrapped:'0',total=add(used,scrapped),status=compare(total,'0')===0?'released':compare(total,line.quantity)===0?'consumed':'settled';
     const managed={...reservation.data.managed,...(intent.action!=='reserve'?{settlement:{operationId:intent.id,action:intent.action,decisionHash:inventoryOperationHash(decision),used,scrapped}}:{})};
     await put('reservation',reservation.id,{...reservation.data,status,managed});
     for(const [kind,quantity] of [['used',used],['scrapped',scrapped]])if(compare(quantity,'0')>0)await put('movement',inventoryPhaseId(intent.id,namespace,kind+'/'+line.lineId),{resourceId:line.resourceId,projectId:line.sourceProjectId,delta:negate(quantity),unit:line.unit,reason:kind==='used'?'Used in linked bill of materials':'Scrapped in linked bill of materials',links:[bomRef(intent)],reservationId:reservation.id});
     const resource=await get(line.resourceId);await put('resource',resource.id,resource.data);
    }
   });evidence=written.evidence;
  }
  const value={version:1,operationId:intent.id,action:intent.action,sourceWorkspaceId:namespace,bom:bomRef(intent),planHash:plan.planHash,decisionHash:inventoryOperationHash(decision),lines:p.lines.map(({resourceRevision,...line})=>line),event:evidence};
  const receipt={version:1,id:intent.id,outcome:decision.outcome,value};await journal.once('receipt',intent.id,receipt);
  for(const line of p.lines){
   if(intent.action!=='reserve'){const claim=await journal.read('claim',line.reservationId);if(claim?.operationId===intent.id)await journal.remove('claim',line.reservationId);}
   if(intent.action==='reserve'&&decision.outcome==='abort'||intent.action!=='reserve'&&decision.outcome==='commit')await journal.remove('live',line.reservationId);
  }
  await journal.remove('pending',intent.id);return receipt;
 });
}
