// Durable BOM decisions across independent inventory owners. No owner transaction
// remains open while another owner is visited. Access is request-owned and never persisted.
import {inventoryOwnerTransaction,inventoryPhaseId} from './inventory-operation-transaction.js';
import {InventoryOperationStore,inventoryOperationHash} from './inventory-operation-store.js';
import {prepareInventoryParticipant,applyInventoryParticipant} from './inventory-operation-participant.js';
import {moduleCommandFingerprint} from './modules/command-fingerprint.js';
import {validateBOM} from './modules/bom.js';
import {materialRecordSummary} from './material-record-summary.js';
import {requiredQuantity} from './web/modules/bom-model.js';
import {exact,uuid,requireValue} from './modules/validation.js';
import {decimal,add,compare} from './web/modules/quantities.js';
import {AppError,safeError} from './errors.js';
const actions=new Map([['bom.reserve','reserve'],['bom.finish','finish'],['bom.cancel','cancel']]);
const terminal=value=>value.phase==='complete'||value.phase==='aborted';
const reference=(id,workspaceId)=>typeof id==='string'?{workspaceId,type:'resource',id}:id;
const key=value=>JSON.stringify([value.workspaceId,value.id]);
const pointer=(id,operationId)=>({version:1,id,operationId});
const errorSummary=(error,owner)=>({code:safeError(error).code,owner:{...(uuid(owner?.workspaceId)?{workspaceId:owner.workspaceId}:{}),...(uuid(error.projectId??owner?.projectId)?{projectId:error.projectId??owner.projectId}:{}),...(uuid(error.labBookId??owner?.labBookId)?{labBookId:error.labBookId??owner.labBookId}:{}),...(uuid(error.sourceWorkspaceId)?{sourceWorkspaceId:error.sourceWorkspaceId}:{})}});
const local=(storage,ns,options,fn)=>inventoryOwnerTransaction(storage,ns,'bom',options,fn);
function summary(intent,status){const decision=status.decision??null;return {id:intent.id,bomId:intent.bomId,action:intent.action,phase:status.phase,decision,terminal:terminal(status),participants:intent.participants.length,remaining:intent.participants.length-(decision?status.applied:status.prepared).length,error:status.error??null,canResume:!terminal(status),canAbort:!terminal(status)&&decision===null,...(intent.action==='finish'?{usage:intent.command.payload.usage}:{})};}
async function state(tx,id){const intent=await tx.journal.read('intent',id);if(!intent)return null;const status=await tx.journal.read('status',id);if(!status||intent.role!=='coordinator')throw new AppError('CATALOGUE_DAMAGED');return {intent,status};}
export async function inventoryOperationStatus(storage,workspaceId,data={},options={}){
 return local(storage,workspaceId,{...options,write:false},async tx=>{let id=data.id;if(id!==undefined&&!uuid(id)||data.bomId!==undefined&&!uuid(data.bomId))throw new AppError('INVALID');if(!id&&data.bomId)id=(await tx.journal.read('current',data.bomId))?.operationId;if(!id)return {workspaceId,operation:null};const value=await state(tx,id);return {workspaceId,operation:value?summary(value.intent,value.status):null};});
}
async function begin(storage,workspaceId,command,options){
 const action=actions.get(command.action);if(!action)return null;
 // Ordinary local BOM commands retain their existing writer path. Classification
 // is a snapshot read; the managed writer below repeats every admission check.
 const managed=await local(storage,workspaceId,{...options,write:false},async tx=>{
  if(await state(tx,command.commandId))return true;
  if(await tx.identities.locate('command',command.commandId))return false;
  if(!uuid(command.payload.id))throw new AppError('INVALID');const bom=await tx.selected(command.payload.id);
  requireValue(bom?.type==='bom','Choose a saved bill of materials');
  return !!bom.data.externalStock||bom.data.lines.some(line=>!line.dnp&&line.resourceId&&typeof line.resourceId==='object');
 });if(!managed)return null;
 return local(storage,workspaceId,{...options,write:true},async tx=>{
  const saved=await state(tx,command.commandId);if(saved){if(saved.intent.fingerprint!==moduleCommandFingerprint(command))throw new AppError('MODULE_REPLAY');return saved;}
  // Existing ordinary command receipts retain their normal legacy replay path.
  if(await tx.identities.locate('command',command.commandId))return null;
  const p=command.payload;if(!uuid(p.id))throw new AppError('INVALID');const bom=await tx.selected(p.id);
  requireValue(bom?.type==='bom','Choose a saved bill of materials');
  const active=bom.data.lines.filter(line=>!line.dnp),external=!!bom.data.externalStock||active.some(line=>line.resourceId&&typeof line.resourceId==='object');if(!external)return null;
  const current=await tx.journal.read('current',p.id);if(current&&await tx.journal.read('pending',current.operationId))throw new AppError('INVENTORY_OPERATION_BUSY');
  requireValue(bom.revision===p.expectedRevision,'The bill of materials changed','MODULE_CHANGED');requireValue(bom.data.status===(action==='reserve'?'draft':'reserved'),'The bill of materials state changed','MODULE_CHANGED');validateBOM(bom.data);
  requireValue(exact(p,action==='reserve'?['id','expectedRevision','resources']:action==='finish'?['id','expectedRevision','usage']:['id','expectedRevision']),'Bill of materials request');
  const resources=new Map();
  if(action==='reserve'){
   requireValue(Array.isArray(p.resources)&&p.resources.length<=200,'Stock choices');for(const item of p.resources){const ref=reference(item?.id,workspaceId);requireValue(exact(item,['id','revision'])&&exact(ref,['workspaceId','type','id'])&&uuid(ref.workspaceId)&&ref.type==='resource'&&uuid(ref.id)&&Number.isSafeInteger(item.revision)&&item.revision>0&&!resources.has(key(ref)),'Stock choice revision');resources.set(key(ref),item.revision);}
   const snapshot=await tx.context.research.snapshot(),record=await materialRecordSummary(tx.context.research,await tx.context.research.member(snapshot,bom.data.recordId));requireValue(record&&record.revision===bom.data.recordRevision,'The linked record changed','MODULE_CHANGED');
  }
  if(action==='finish'){requireValue(Array.isArray(p.usage)&&p.usage.length===active.length&&new Set(p.usage.map(v=>v.lineId)).size===p.usage.length,'Actual usage');for(const use of p.usage)requireValue(exact(use,['lineId','used','scrapped'])&&active.some(l=>l.id===use.lineId)&&decimal(use.used)&&decimal(use.scrapped)&&compare(use.used,'0')>=0&&compare(use.scrapped,'0')>=0,'Actual usage');}
  requireValue(active.length>0,'Populate this bill of materials');const participants=new Map(),usedResources=new Set();
  for(const line of active){
   const ref=reference(line.resourceId,workspaceId);requireValue(ref&&uuid(ref.workspaceId)&&ref.type==='resource'&&uuid(ref.id),'Choose a stock item');
   if(!participants.has(ref.workspaceId))participants.set(ref.workspaceId,{workspaceId:ref.workspaceId,lines:[]});
   const quantity=requiredQuantity(bom.data,line),usage=action==='finish'?p.usage.find(value=>value.lineId===line.id):{used:'0',scrapped:'0'};
   requireValue(compare(add(usage.used,usage.scrapped),quantity)<=0,'Actual use exceeds reserved stock');
   const allocation=bom.data.allocations.find(value=>value.lineId===line.id),resourceRevision=resources.get(key(ref));if(action==='reserve'){requireValue(resourceRevision!==undefined,'Review the stock choices');usedResources.add(key(ref));}else requireValue(allocation?.workspaceId===ref.workspaceId&&uuid(allocation.reservationId),'The managed allocation changed','MODULE_CHANGED');
   participants.get(ref.workspaceId).lines.push({lineId:line.id,resourceId:ref.id,sourceProjectId:line.sourceProjectId,reservationId:action==='reserve'?inventoryPhaseId(command.commandId,ref.workspaceId,'reservation/'+line.id):allocation.reservationId,quantity,unit:line.unit,used:usage.used,scrapped:usage.scrapped,...(action==='reserve'?{resourceRevision}:{})});
  }
  requireValue(action!=='reserve'||usedResources.size===resources.size,'Review the exact stock choices');if(participants.size>32)throw new AppError('INVENTORY_OWNER_LIMIT');
  const intent={version:1,id:command.commandId,role:'coordinator',workspaceId,bomId:bom.id,bomRevision:bom.revision,action,command:structuredClone(command),fingerprint:moduleCommandFingerprint(command),reservationOperationId:action==='reserve'?command.commandId:bom.data.externalStock.reservation.operationId,participants:[...participants.values()].sort((a,b)=>a.workspaceId.localeCompare(b.workspaceId)),at:new Date().toISOString()};
  const status={version:1,id:intent.id,phase:'preparing',decision:null,prepared:[],applied:[],error:null};await tx.journal.once('intent',intent.id,intent);await tx.journal.write('status',intent.id,status);await tx.journal.write('pending',intent.id,pointer(intent.id,intent.id));await tx.journal.write('current',bom.id,pointer(bom.id,intent.id));return {intent,status};
 });
}
async function progress(storage,workspaceId,id,options,{abort=false}={}){
 let access=null,currentOwner=null,failure=null;const read=()=>local(storage,workspaceId,{check:options.check,signal:options.signal,write:false},tx=>state(tx,id));let initial=await read();if(!initial)throw new AppError('NOT_FOUND');const {intent}=initial;
 const accessFor=async()=>{if(!options.sourceAccess)throw new AppError('MODULE_REFERENCE');access??=await options.sourceAccess(workspaceId,{signal:options.signal});return access;};
 const verify=async()=>{options.signal?.throwIfAborted();await options.check?.();await access?.verify();};
 const visit=async(p,fn)=>{currentOwner={workspaceId:p.workspaceId};if(p.workspaceId===workspaceId)return fn(storage,{check:verify});const adapter=await accessFor();return adapter.useOwner(p.workspaceId,async(source,owner,{check})=>{currentOwner=owner;return fn(source,{check:async()=>{await verify();await check();}});});};
 const mutate=fn=>local(storage,workspaceId,{check:options.check,signal:options.signal,write:true},async tx=>{const value=await state(tx,id);return fn(tx,value);});
 const choose=async outcome=>{const decision=await mutate(async(tx,value)=>{const old=await tx.journal.read('decision',id);if(old){if(old.outcome!==outcome)throw new AppError('INVENTORY_OPERATION_BUSY');return old;}if(outcome==='commit'&&value.status.prepared.length!==intent.participants.length)throw new AppError('CATALOGUE_DAMAGED');if(outcome==='commit')await verify();const decision={version:1,id,planHash:inventoryOperationHash(intent),outcome};await tx.journal.once('decision',id,decision);await tx.journal.write('status',id,{...value.status,decision:outcome,phase:outcome==='commit'?'committing':'aborting'});return decision;});await options.checkpoint?.('decision',{id,decision:decision.outcome});return decision;};
 const pending=async()=>{const value=await read();return {workspaceId,operationPending:!terminal(value.status),operation:summary(value.intent,value.status)};};
 try{
  if(initial.status.phase==='aborted')return pending();
  if(initial.status.phase==='complete'){if(abort)throw new AppError('INVENTORY_OPERATION_BUSY');return local(storage,workspaceId,{check:options.check,signal:options.signal,write:false,events:true},async tx=>(await tx.event(intent.command)).result);}
  if(abort){if(initial.status.phase==='complete')throw new AppError('INVENTORY_OPERATION_BUSY');await choose('abort');}
  for(const p of intent.participants){
   let value=await read();if(value.status.decision)break;if(value.status.prepared.includes(p.workspaceId))continue;
   try{const prepared=await visit(p,(source,auth)=>prepareInventoryParticipant(source,p.workspaceId,intent,p,{...auth,signal:options.signal}));await options.checkpoint?.('source-prepared',{id,workspaceId:p.workspaceId});if(prepared.terminal){const latest=await read();if(prepared.outcome==='commit'){if(latest.status.decision!=='commit')throw new AppError('CATALOGUE_DAMAGED');break;}await choose('abort');break;}
    await mutate(async(tx,latest)=>{if(!latest.status.prepared.includes(p.workspaceId))await tx.journal.write('status',id,{...latest.status,prepared:[...latest.status.prepared,p.workspaceId],error:null});});await options.checkpoint?.('prepared',{id,workspaceId:p.workspaceId});
   }catch(error){if(!['STOCK_UNAVAILABLE','MODULE_CHANGED','MODULE_FORMAT'].includes(error.code))throw error;await mutate(async(tx,latest)=>tx.journal.write('status',id,{...latest.status,error:errorSummary(error,currentOwner)}));await choose('abort');break;}
  }
  let value=await read(),decision=value.status.decision?await local(storage,workspaceId,{check:options.check,signal:options.signal,write:false},tx=>tx.journal.read('decision',id)):await choose('commit');
  for(const p of intent.participants){value=await read();if(value.status.applied.includes(p.workspaceId))continue;
   const receipt=await visit(p,(source,auth)=>applyInventoryParticipant(source,p.workspaceId,intent,p,decision,{...auth,signal:options.signal}));await options.checkpoint?.('source-applied',{id,workspaceId:p.workspaceId});
   await mutate(async(tx,latest)=>{await tx.journal.once('receipt',inventoryPhaseId(id,p.workspaceId,'ack'),{version:1,id:inventoryPhaseId(id,p.workspaceId,'ack'),operationId:id,sourceWorkspaceId:p.workspaceId,receipt});if(!latest.status.applied.includes(p.workspaceId))await tx.journal.write('status',id,{...latest.status,applied:[...latest.status.applied,p.workspaceId]});});await options.checkpoint?.('applied',{id,workspaceId:p.workspaceId});
  }
  if(decision.outcome==='abort'){await mutate(async(tx,latest)=>{await tx.journal.write('status',id,{...latest.status,phase:'aborted'});await tx.journal.remove('pending',id);});return pending();}
  const result=await local(storage,workspaceId,{check:verify,signal:options.signal,write:true,events:true},async tx=>{
   const value=await state(tx,id);if(value.status.phase==='complete')return (await tx.event(intent.command)).result;if(value.status.applied.length!==intent.participants.length)throw new AppError('CATALOGUE_DAMAGED');const receipts=[];
   for(const p of intent.participants){const ack=await tx.journal.read('receipt',inventoryPhaseId(id,p.workspaceId,'ack'));if(ack?.receipt.outcome!=='commit')throw new AppError('CATALOGUE_DAMAGED');receipts.push(ack.receipt.value);}
   const written=await tx.event(intent.command,async({get,put})=>{const bom=await get(intent.bomId);if(bom?.revision!==intent.bomRevision)throw new AppError('MODULE_CHANGED');const externalStock=intent.action==='reserve'?{version:1,reservation:{operationId:id,receipts},settlement:null}:{...bom.data.externalStock,settlement:{operationId:id,receipts}};
    const data={...bom.data,status:intent.action==='reserve'?'reserved':intent.action==='finish'?'finished':'cancelled',externalStock,...(intent.action==='reserve'?{allocations:intent.participants.flatMap(p=>p.lines.map(line=>({lineId:line.lineId,reservationId:line.reservationId,workspaceId:p.workspaceId})))}:{}),...(intent.action==='finish'?{usage:intent.command.payload.usage}:{})};await put('bom',bom.id,data);});
   await tx.journal.once('receipt',id,{version:1,id,outcome:'commit',event:written.evidence});await tx.journal.write('status',id,{...value.status,phase:'complete',error:null});await tx.journal.remove('pending',id);
   if(intent.action==='reserve')await tx.journal.write('live',intent.bomId,pointer(intent.bomId,id));else await tx.journal.remove('live',intent.bomId);return written.result;
  });await options.checkpoint?.('complete',{id});return result;
 }catch(error){
  failure=error;
  if(error.name==='AbortError'||options.signal?.aborted)throw error;
  if(['CATALOGUE_DAMAGED','MODULE_REPLAY','INVENTORY_OPERATION_BUSY'].includes(error.code))throw error;
  await mutate(async(tx,value)=>{if(!terminal(value.status))await tx.journal.write('status',id,{...value.status,error:errorSummary(error,currentOwner)});});return pending();
 }finally{try{await access?.close();}catch(error){if(!failure)throw error;}}
}
export async function executeInventoryOperation(storage,workspaceId,command,options={}){const value=await begin(storage,workspaceId,command,options);if(!value)return null;await options.checkpoint?.('intent',{id:value.intent.id});return progress(storage,workspaceId,value.intent.id,options);}
export async function resumeInventoryOperation(storage,workspaceId,{id},options={}){if(!uuid(id))throw new AppError('INVALID');return progress(storage,workspaceId,id,options);}
export async function abortInventoryOperation(storage,workspaceId,{id},options={}){if(!uuid(id))throw new AppError('INVALID');return progress(storage,workspaceId,id,options,{abort:true});}
export async function assertNoPendingBOM(context,id){if(!uuid(id)||!context.registry.domains.includes('bom'))return;const store=await context.inspect('bom'),journal=new InventoryOperationStore(store),current=await journal.read('current',id);if(current&&await journal.read('pending',current.operationId))throw new AppError('INVENTORY_OPERATION_BUSY');}
