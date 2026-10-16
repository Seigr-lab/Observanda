// Verify only this owner's immutable protocol evidence. Foreign receipts are
// retained facts; verification never opens another owner's stock or credentials.
import {InventoryOperationStore,inventoryOperationHash,inventoryOperationPrefix} from './inventory-operation-store.js';
import {inventoryPhaseId} from './inventory-operation-identity.js';
import {ProjectModuleIdentities,moduleEventHash} from './project-module-identities.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {ObjectIndex} from './object-index.js';
import {moduleCommandFingerprint} from './modules/command-fingerprint.js';
import {validateBOMReceipt,validateExternalBOMStock} from './modules/bom-integrity.js';
import {exact,uuid,instant,unique} from './modules/validation.js';
import {serialize} from './storage-format.js';
import {add,compare,negate} from './web/modules/quantities.js';
import {AppError} from './errors.js';
const require=value=>{if(!value)throw new AppError('CATALOGUE_DAMAGED');};
const same=(a,b)=>serialize(a)===serialize(b);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const reference=value=>exact(value,['workspaceId','type','id'])&&uuid(value.workspaceId)&&value.type==='bom'&&uuid(value.id);
const pointer=(value,id,operationId)=>exact(value,['version','id','operationId'])&&value.version===1&&value.id===id&&value.operationId===operationId;
const actions=['reserve','finish','cancel'];
const evidenceShape={commandId:'00000000-0000-4000-a000-000000000000',id:'00000000-0000-4000-a000-000000000000',ordinal:1,hash:'0'.repeat(64)};
function lines(values,action){
 require(Array.isArray(values)&&values.length>0&&values.length<=200);
 for(const line of values)require(exact(line,['lineId','resourceId','sourceProjectId','reservationId','quantity','unit','used','scrapped',...(action==='reserve'?['resourceRevision']:[])])&&(action!=='reserve'||Number.isSafeInteger(line.resourceRevision)&&line.resourceRevision>0));
 validateBOMReceipt({version:1,operationId:evidenceShape.id,action,sourceWorkspaceId:evidenceShape.id,bom:{workspaceId:evidenceShape.id,type:'bom',id:evidenceShape.id},planHash:evidenceShape.hash,decisionHash:evidenceShape.hash,lines:values.map(({resourceRevision,...line})=>line),event:evidenceShape});
}
function intentShape(intent,domain,namespace){
 require(intent?.version===1&&uuid(intent.id)&&intent.workspaceId===namespace&&actions.includes(intent.action)&&uuid(intent.reservationOperationId)&&instant(intent.at));
 if(domain==='bom'){
  require(exact(intent,['version','id','role','workspaceId','bomId','bomRevision','action','command','fingerprint','reservationOperationId','participants','at'])&&intent.role==='coordinator'&&uuid(intent.bomId)&&Number.isSafeInteger(intent.bomRevision)&&intent.bomRevision>0&&hash(intent.fingerprint));
  require(exact(intent.command,['workspaceId','commandId','action','payload'])&&intent.command.workspaceId===namespace&&intent.command.commandId===intent.id&&intent.command.action==='bom.'+intent.action&&intent.command.payload?.id===intent.bomId&&intent.command.payload.expectedRevision===intent.bomRevision&&moduleCommandFingerprint(intent.command)===intent.fingerprint);
  require(Array.isArray(intent.participants)&&intent.participants.length>0&&intent.participants.length<=32&&unique(intent.participants.map(p=>p?.workspaceId)));
  for(const p of intent.participants){require(exact(p,['workspaceId','lines'])&&uuid(p.workspaceId));lines(p.lines,intent.action);}
  const all=intent.participants.flatMap(p=>p.lines);require(all.length<=200&&unique(all.map(l=>l.lineId)));
 }else{
  require(exact(intent,['version','id','role','workspaceId','bom','action','planHash','reservationOperationId','lines','at'])&&intent.role==='participant'&&reference(intent.bom)&&hash(intent.planHash));lines(intent.lines,intent.action);
 }
 require(intent.action==='reserve'?intent.reservationOperationId===intent.id:intent.reservationOperationId!==intent.id);
}
const bomReference=intent=>intent.role==='coordinator'?{workspaceId:intent.workspaceId,type:'bom',id:intent.bomId}:intent.bom;
const decisionShape=(decision,intent)=>exact(decision,['version','id','planHash','outcome'])&&decision.version===1&&decision.id===intent.id&&decision.planHash===(intent.role==='coordinator'?inventoryOperationHash(intent):intent.planHash)&&['commit','abort'].includes(decision.outcome);
async function* objects(journal,kind){let after=null;for(;;){let count=0;for await(const value of journal.entries(kind,{after,limit:100})){after=value.id;count++;yield value;}if(count<100)return;}}
export async function verifyInventoryOperations(context){
 if(context.registry.commandVersion!==1)return;
 const identities=new ProjectModuleIdentities(context.research,context.registry,context.inspect),namespace=context.registry.namespaceId;
 async function event(domain,evidence,command){
  require(exact(evidence,['commandId','id','ordinal','hash'])&&evidence.commandId===command.commandId);
  const receipt=await identities.locate('command',evidence.commandId);require(receipt&&receipt.primary===domain&&receipt.fingerprint===moduleCommandFingerprint(command));
  const fragments=await identities.fragments(receipt),fragment=fragments.find(value=>value.domain===domain),position=receipt.fragments.find(value=>value.domain===domain);
  require(fragment&&position.ordinal===evidence.ordinal&&fragment.event.id===evidence.id&&moduleEventHash(fragment.event)===evidence.hash);return fragment.event;
 }
 async function phaseEvent(intent,evidence,phase){
  const command={workspaceId:namespace,commandId:inventoryPhaseId(intent.id,namespace,phase),action:'inventory.bom.'+phase,payload:{operationId:intent.id,planHash:intent.planHash}};
  const original=await new InventoryOperationStore(await context.inspect('inventory')).read('intent',intent.reservationOperationId);require(original?.action==='reserve');
  const value=await event('inventory',evidence,command),changes=new Map(value.changes.map(entity=>[entity.id,entity])),expected=new Set();
  for(const line of intent.lines){
   const reservation=changes.get(line.reservationId),d=reservation?.data,m=d?.managed;expected.add(line.reservationId);expected.add(line.resourceId);
   require(reservation?.type==='reservation'&&d.resourceId===line.resourceId&&d.projectId===line.sourceProjectId&&d.unit===line.unit&&compare(d.quantity,line.quantity)===0&&m?.operationId===intent.reservationOperationId&&m.lineId===line.lineId&&m.planHash===original.planHash&&same(m.bom,intent.bom));
   require(changes.get(line.resourceId)?.type==='resource');
   if(phase==='prepare')require(d.status==='active'&&m.planHash===intent.planHash&&!m.settlement);
   else if(intent.action==='reserve')require(d.status==='released'&&!m.settlement);
   else{
    const settlement=m.settlement;require(settlement?.operationId===intent.id&&settlement.action===intent.action&&settlement.decisionHash===inventoryOperationHash({version:1,id:intent.id,planHash:intent.planHash,outcome:'commit'})&&compare(settlement.used,line.used)===0&&compare(settlement.scrapped,line.scrapped)===0);
    const total=add(line.used,line.scrapped);require(d.status===(compare(total,'0')===0?'released':compare(total,line.quantity)===0?'consumed':'settled'));
    for(const [kind,quantity] of [['used',line.used],['scrapped',line.scrapped]])if(compare(quantity,'0')>0){const id=inventoryPhaseId(intent.id,namespace,kind+'/'+line.lineId),movement=changes.get(id)?.data;expected.add(id);require(changes.get(id)?.type==='movement'&&movement.resourceId===line.resourceId&&movement.projectId===line.sourceProjectId&&movement.reservationId===line.reservationId&&movement.unit===line.unit&&compare(movement.delta,negate(quantity))===0);}
   }
  }
  require(expected.size===changes.size&&[...changes.keys()].every(id=>expected.has(id)));return value;
 }
 for(const domain of ['bom','inventory']){
  if(!context.registry.domains.includes(domain))continue;const store=await context.inspect(domain),journal=new InventoryOperationStore(store),catalogue=new ModuleCatalogue(store),head=await catalogue.head(namespace);
  const index=new ObjectIndex(store),objectHead=await index.head();
  for await(const entry of index.entries(objectHead,inventoryOperationPrefix))require(/^(intent|decision|status|prepared|receipt|pending|live|current|claim)\/[a-f0-9-]+$/.test(entry.id.slice(inventoryOperationPrefix.length))&&uuid(entry.id.slice(entry.id.lastIndexOf('/')+1)));
  for await(const intent of objects(journal,'intent')){
   intentShape(intent,domain,namespace);const decision=await journal.read('decision',intent.id),prepared=await journal.read('prepared',intent.id),receipt=await journal.read('receipt',intent.id),pending=await journal.read('pending',intent.id);
   if(decision)require(decisionShape(decision,intent));
   if(domain==='inventory'){
    require(!await journal.read('status',intent.id));
    if(intent.action!=='reserve')require((await journal.read('receipt',intent.reservationOperationId))?.outcome==='commit');
    if(prepared){require(exact(prepared,['version','id','planHash','evidence'])&&prepared.planHash===intent.planHash);if(intent.action==='reserve')await phaseEvent(intent,prepared.evidence,'prepare');else require(prepared.evidence===null);}
    require(!!pending===!!prepared&&!receipt||!pending&&!!receipt);
    if(pending)require(pointer(pending,intent.id,intent.id));
    if(receipt){
     require(exact(receipt,['version','id','outcome','value'])&&receipt.outcome===decision?.outcome);const value=receipt.value;
     require(value?.operationId===intent.id&&value.action===intent.action&&value.sourceWorkspaceId===namespace&&same(value.bom,intent.bom)&&value.planHash===intent.planHash&&value.decisionHash===inventoryOperationHash(decision)&&same(value.lines,intent.lines.map(({resourceRevision,...line})=>line)));
     if(receipt.outcome==='commit'){require(prepared);validateBOMReceipt(value);await phaseEvent(intent,value.event,intent.action==='reserve'?'prepare':'commit');}
     else if(prepared&&intent.action==='reserve')await phaseEvent(intent,value.event,'abort');else require(value.event===null);
    }
    for(const line of intent.lines)if(prepared&&intent.action!=='reserve'&&!receipt)require(pointer(await journal.read('claim',line.reservationId),line.reservationId,intent.id));
   }else{
    require(!prepared);const status=await journal.read('status',intent.id),owners=intent.participants.map(p=>p.workspaceId);
    require(exact(status,['version','id','phase','decision','prepared','applied','error'])&&['preparing','committing','aborting','complete','aborted'].includes(status.phase)&&status.decision===(decision?.outcome??null));
    for(const names of [status.prepared,status.applied])require(Array.isArray(names)&&unique(names)&&names.every(id=>owners.includes(id)));
    require(decision?decision.outcome==='commit'?['committing','complete'].includes(status.phase)&&status.prepared.length===owners.length:['aborting','aborted'].includes(status.phase):status.phase==='preparing'&&status.applied.length===0);
    const terminal=['complete','aborted'].includes(status.phase);require(!!pending===!terminal);if(pending){require(pointer(pending,intent.id,intent.id));require(pointer(await journal.read('current',intent.bomId),intent.bomId,intent.id));}
    require(status.error===null||exact(status.error,['code','owner'])&&typeof status.error.code==='string'&&exact(status.error.owner,Object.keys(status.error.owner))&&Object.keys(status.error.owner).every(k=>['workspaceId','projectId','labBookId','sourceWorkspaceId'].includes(k)&&uuid(status.error.owner[k])));
    for(const id of status.applied){const ack=await journal.read('receipt',inventoryPhaseId(intent.id,id,'ack')),part=intent.participants.find(p=>p.workspaceId===id);require(exact(ack,['version','id','operationId','sourceWorkspaceId','receipt'])&&ack.operationId===intent.id&&ack.sourceWorkspaceId===id&&ack.receipt?.outcome===decision?.outcome);const v=ack.receipt.value;require(v?.sourceWorkspaceId===id&&v.operationId===intent.id&&v.action===intent.action&&same(v.bom,bomReference(intent))&&v.planHash===inventoryOperationHash(intent)&&v.decisionHash===inventoryOperationHash(decision)&&same(v.lines,part.lines.map(({resourceRevision,...line})=>line)));if(decision.outcome==='commit')validateBOMReceipt(v);}
    if(terminal)require(status.applied.length===owners.length);
    if(status.phase==='complete'){
     require(decision?.outcome==='commit'&&status.prepared.length===owners.length&&exact(receipt,['version','id','outcome','event'])&&receipt.outcome==='commit');
     const committed=await event('bom',receipt.event,intent.command);require(committed.changes.length===1&&committed.changes[0].id===intent.bomId&&committed.changes[0].revision===intent.bomRevision+1);
     const bom=committed.changes[0];validateExternalBOMStock(bom.data,namespace,bom.id);const retained=intent.action==='reserve'?bom.data.externalStock.reservation:bom.data.externalStock.settlement;require(retained.operationId===intent.id);
     for(const r of retained.receipts)require(same((await journal.read('receipt',inventoryPhaseId(intent.id,r.sourceWorkspaceId,'ack')))?.receipt.value,r));
    }else require(!receipt);
    if(status.phase==='aborted')require(decision?.outcome==='abort');
   }
  }
  // Reverse checks ensure removing a journal or adding an orphan pointer cannot
  // conceal a live obligation from the indexed copy/delete admission guard.
  for(const kind of ['decision','prepared','status','receipt','pending','live','current','claim'])for await(const value of objects(journal,kind)){
   if(kind==='live'||kind==='current'||kind==='claim'||kind==='pending'){
    require(pointer(value,value.id,value.operationId)&&uuid(value.operationId));const intent=await journal.read('intent',value.operationId);require(intent);intentShape(intent,domain,namespace);
    if(kind==='pending')require(value.id===intent.id);
    else if(kind==='current')require(domain==='bom'&&value.id===intent.bomId);
    else if(kind==='live'){
     const entity=await catalogue.selected(head,value.id);require(domain==='bom'?entity?.type==='bom'&&entity.data.status==='reserved'&&entity.data.externalStock?.reservation.operationId===intent.id:entity?.type==='reservation'&&entity.data.status==='active'&&entity.data.managed?.operationId===intent.id);
    }else require(domain==='inventory'&&intent.action!=='reserve'&&intent.lines.some(line=>line.reservationId===value.id)&&await journal.read('prepared',intent.id)&&!await journal.read('receipt',intent.id));
   }else{
    const intent=await journal.read('intent',value.operationId??value.id);require(intent);
    if(kind==='receipt'&&value.operationId){require(domain==='bom'&&value.id===inventoryPhaseId(intent.id,value.sourceWorkspaceId,'ack'));const status=await journal.read('status',intent.id);require(status.applied.includes(value.sourceWorkspaceId));}
   }
  }
  for await(const member of catalogue.members(head,{types:domain==='bom'?['bom']:['reservation']})){
   const entity=await catalogue.selected(head,member.id),d=entity.data;
   if(domain==='bom'&&d.externalStock){for(const operation of [d.externalStock.reservation,d.externalStock.settlement].filter(Boolean)){const intent=await journal.read('intent',operation.operationId),status=await journal.read('status',operation.operationId);require(intent?.bomId===entity.id&&status?.phase==='complete');for(const r of operation.receipts)require(same((await journal.read('receipt',inventoryPhaseId(operation.operationId,r.sourceWorkspaceId,'ack')))?.receipt.value,r));}if(d.status==='reserved')require(pointer(await journal.read('live',entity.id),entity.id,d.externalStock.reservation.operationId));}
   if(domain==='inventory'&&d.managed){const intent=await journal.read('intent',d.managed.operationId),line=intent?.lines.find(line=>line.reservationId===entity.id);require(intent?.action==='reserve'&&line&&intent.planHash===d.managed.planHash&&same(intent.bom,d.managed.bom)&&line.lineId===d.managed.lineId&&line.resourceId===d.resourceId&&line.sourceProjectId===d.projectId&&line.unit===d.unit&&compare(line.quantity,d.quantity)===0&&await journal.read('prepared',intent.id));if(d.status==='active')require(pointer(await journal.read('live',entity.id),entity.id,intent.id));else if(d.managed.settlement){const receipt=await journal.read('receipt',d.managed.settlement.operationId);require(receipt?.outcome==='commit'&&receipt.value.decisionHash===d.managed.settlement.decisionHash&&receipt.value.lines.some(l=>l.reservationId===entity.id));}else require((await journal.read('receipt',intent.id))?.outcome==='abort');}
  }
 }
}
