// Project-domain command coordinator for explicitly selected project routes.
import {replayProjectModuleEvent,writeProjectModuleEvent} from './project-module-event.js';
import {ProjectDomains} from './project-domains.js';
import {ProjectModuleIdentities} from './project-module-identities.js';
import {projectModuleFederation} from './project-module-federation.js';
import {workspaceModules} from './modules/index.js';
import {moduleDomains} from './modules/domains.js';
import {moduleCommandPlan} from './modules/domain-command-plan.js';
import {moduleCommandFingerprint} from './modules/command-fingerprint.js';
import {prepareModuleCommand} from './modules/prepare-command.js';
import {exact,uuid,object,requireValue} from './modules/validation.js';
import {MODULE_BYTES} from './modules/capacity.js';
import {materialRecordSummary} from './material-record-summary.js';
import {AppError} from './errors.js';
import {withPlanningTaskAdmission} from './planning-task-admission.js';
import {executeInventoryOperation,assertNoPendingBOM} from './inventory-operation-coordinator.js';
import {prepareInventoryBOMResources} from './inventory-bom-resources.js';
export class ProjectModuleCommands{
 constructor(storage,namespaceId){this.storage=storage;this.namespaceId=namespaceId;this.domains=new ProjectDomains(storage,namespaceId);}
 initialize(){return this.domains.initialize(moduleDomains,{commands:true});}
 async execute(command,{signal,check,referenceAccess,taskSourceAccess,inventorySourceAccess}={}){
  if(Buffer.byteLength(JSON.stringify(command))>MODULE_BYTES)throw new AppError('LIMIT');
  requireValue(exact(command,['workspaceId','commandId','action','payload'])&&uuid(command.workspaceId)&&uuid(command.commandId)&&typeof command.action==='string'&&object(command.payload),'command');
  if(command.workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');
  if(['bom.reserve','bom.finish','bom.cancel'].includes(command.action)){const result=await executeInventoryOperation(this.storage,this.namespaceId,command,{sourceAccess:inventorySourceAccess,check,signal});if(result)return result;}
  const plan=moduleCommandPlan(command),participants=[...plan.read,...plan.write].sort(),fingerprint=moduleCommandFingerprint(command),owner=workspaceModules(this.storage);
  let bomResources=null;
  let references=null;const externalReference=referenceAccess?async ref=>{references??=await referenceAccess(this.namespaceId,{signal});return references.validate(ref);}:null;
  try{
  const retained=()=>this.domains.run([],async(_get,{research,registry,inspect})=>new ProjectModuleIdentities(research,registry,inspect).locate('command',command.commandId),{signal,check});
  const perform=async({taskPrerequisites}={})=>{
  const current=async()=>{await check?.();await references?.verify();await bomResources?.verify();await taskPrerequisites?.verify();};
  // Only this command transaction is retried, never arbitrary caller callbacks.
  // Handlers prepare changes/read sources; persistence occurs below in one txn.
  for(let attempt=0;;attempt++)try{return await this.domains.run(participants,async(get,context)=>{
   const {research,registry,inspect}=context,identities=new ProjectModuleIdentities(research,registry,inspect),receipt=await identities.locate('command',command.commandId);
   const federation=await projectModuleFederation(identities,participants);
   if(receipt)return replayProjectModuleEvent({owner,identities,federation,plan,command,fingerprint,receipt});
   if(command.action==='bom.save')await assertNoPendingBOM(context,command.payload.id);
   const snapshot=await research.snapshot(),book=snapshot.metadata;
   const lookup=async(id,summary)=>{requireValue(uuid(id),'Record identity');const member=await research.member(snapshot,id);return summary?materialRecordSummary(research,member):Boolean(member);};
   const event=await prepareModuleCommand(owner,federation,federation.head,{book,hasRecord:id=>lookup(id,false),recordSummary:id=>lookup(id,true),externalReference,taskPrerequisites,bomResources},command,fingerprint);
   return writeProjectModuleEvent({owner,identities,federation,plan,command,fingerprint,event});
  },{write:plan.write,signal,consistent:true,check:current});}catch(error){if(!['40001','40P01'].includes(error.code)||attempt>=2)throw error;signal?.throwIfAborted();}
  };
  if(command.action==='bom.save'&&Array.isArray(command.payload.data?.lines)&&command.payload.data.lines.some(line=>line?.resourceId&&typeof line.resourceId==='object'&&line.resourceId.workspaceId!==this.namespaceId)){
   if(await retained())return await perform();
   try{bomResources=await prepareInventoryBOMResources(this.storage,this.namespaceId,command,{sourceAccess:inventorySourceAccess,check,signal});}
   catch(error){signal?.throwIfAborted();await check?.();if(await retained())return await perform();throw error;}
  }
  if(command.action!=='task.save')return await perform();
  // A retained receipt is authoritative even when its former sources are now
  // unavailable. The normal transaction still verifies its exact fingerprint.

  if(await retained())return await perform();
  try{return await withPlanningTaskAdmission(this.storage,this.namespaceId,command,{sourceAccess:taskSourceAccess,check,signal},perform);}
  catch(error){
   // A simultaneous exact retry may commit after preflight. Re-enter the same
   // authoritative receipt transaction without requiring former source access.
   signal?.throwIfAborted();await check?.();if(await retained())return await perform();throw error;
  }
  }finally{try{await references?.close();}finally{await bomResources?.close();}}
 }
}
