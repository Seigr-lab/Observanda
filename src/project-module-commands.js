// Project-domain command coordinator for explicitly selected project routes.
import {projectModuleDomainReceiptMatches} from './project-module-domain-receipts.js';
import {ProjectDomains} from './project-domains.js';
import {ProjectModuleIdentities,moduleEventHash} from './project-module-identities.js';
import {projectModuleFederation} from './project-module-federation.js';
import {workspaceModules} from './modules/index.js';
import {moduleDomain,moduleDomains} from './modules/domains.js';
import {moduleCommandPlan} from './modules/domain-command-plan.js';
import {moduleCommandFingerprint} from './modules/command-fingerprint.js';
import {prepareModuleCommand} from './modules/prepare-command.js';
import {admitModuleChanges} from './modules/command-capacity.js';
import {exact,uuid,object,requireValue} from './modules/validation.js';
import {MODULE_BYTES} from './modules/capacity.js';
import {materialRecordSummary} from './material-record-summary.js';
import {AppError} from './errors.js';
import {withPlanningTaskAdmission} from './planning-task-admission.js';
export class ProjectModuleCommands{
 constructor(storage,namespaceId){this.storage=storage;this.namespaceId=namespaceId;this.domains=new ProjectDomains(storage,namespaceId);}
 initialize(){return this.domains.initialize(moduleDomains,{commands:true});}
 async execute(command,{signal,check,referenceAccess,taskSourceAccess}={}){
  if(Buffer.byteLength(JSON.stringify(command))>MODULE_BYTES)throw new AppError('LIMIT');
  requireValue(exact(command,['workspaceId','commandId','action','payload'])&&uuid(command.workspaceId)&&uuid(command.commandId)&&typeof command.action==='string'&&object(command.payload),'command');
  if(command.workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');
  const plan=moduleCommandPlan(command),participants=[...plan.read,...plan.write].sort(),fingerprint=moduleCommandFingerprint(command),owner=workspaceModules(this.storage);
  let references=null;const externalReference=referenceAccess?async ref=>{references??=await referenceAccess(this.namespaceId,{signal});return references.validate(ref);}:null;
  try{
  const perform=async({taskPrerequisites}={})=>{
  const current=async()=>{await check?.();await references?.verify();await taskPrerequisites?.verify();};
  // Only this command transaction is retried, never arbitrary caller callbacks.
  // Handlers prepare changes/read sources; persistence occurs below in one txn.
  for(let attempt=0;;attempt++)try{return await this.domains.run(participants,async(get,context)=>{
   const {research,registry,inspect}=context,identities=new ProjectModuleIdentities(research,registry,inspect),receipt=await identities.locate('command',command.commandId);
   const federation=await projectModuleFederation(identities,participants),baseRevisions=Object.fromEntries([...federation.owners].map(([domain,o])=>[domain,o.head.revision]));
   let events;
   if(receipt){
    events=await identities.fragments(receipt);
    if(receipt.primary!==plan.primary||receipt.write.join()!==plan.write.join()||!await projectModuleDomainReceiptMatches(research,command,receipt,events,fingerprint)||receipt.fingerprint===fingerprint&&receipt.read.join()!==plan.read.join())throw new AppError('MODULE_REPLAY');
    const entities=[];for(const {event} of events){owner.validateEvent(event);for(const e of event.changes){const current=await federation.selected(federation.head,e.id);if(!current)throw new AppError('CATALOGUE_DAMAGED');owner.validateEntity(current);entities.push(current);}}
    return {workspaceId:this.namespaceId,baseRevisions,revisions:{...baseRevisions},entities,changedIds:entities.map(e=>e.id),replayed:true};
   }
   const snapshot=await research.snapshot(),book=snapshot.metadata;
   const lookup=async(id,summary)=>{requireValue(uuid(id),'Record identity');const member=await research.member(snapshot,id);return summary?materialRecordSummary(research,member):Boolean(member);};
   const event=await prepareModuleCommand(owner,federation,federation.head,{book,hasRecord:id=>lookup(id,false),recordSummary:id=>lookup(id,true),externalReference,taskPrerequisites},command,fingerprint);
   const changes=new Map();for(const entity of event.changes){const domain=moduleDomain(entity.type);if(!plan.write.includes(domain))throw new AppError('MODULE_FORMAT');if(!changes.has(domain))changes.set(domain,[]);changes.get(domain).push(entity);}
   if([...changes.keys()].sort().join()!==plan.write.join())throw new AppError('MODULE_FORMAT');
   events=[];const fragments=[],revisions={...baseRevisions};
   for(const domain of [...changes.keys()].sort()){
    const entities=changes.get(domain),fragment={...event,changes:entities},current=federation.owners.get(domain);
    await admitModuleChanges(current.catalogue,current.head,this.namespaceId,entities,fragment);
    // Claims precede domain writes so absence checks read the old stable roots.
    for(const entity of entities){const existing=await identities.locate('entity',entity.id);if(existing&&existing.domain!==domain)throw new AppError('MODULE_CHANGED');await identities.claim('entity',entity.id,{domain});}
    events.push({domain,event:fragment});fragments.push({domain,ordinal:current.head.revision+1,hash:moduleEventHash(fragment)});
   }
   await identities.claim('command',command.commandId,{primary:plan.primary,fingerprint,originHash:null,action:event.action,eventId:event.id,at:event.at,read:plan.read,write:plan.write,fragments});
   for(const {domain,event:fragment} of events){const current=federation.owners.get(domain);await current.catalogue.writeChanges(current.head,fragment.changes,fragment);revisions[domain]++;}
   return {workspaceId:this.namespaceId,baseRevisions,revisions,entities:event.changes,changedIds:event.changes.map(e=>e.id),replayed:false};
  },{write:plan.write,signal,consistent:true,check:current});}catch(error){if(!['40001','40P01'].includes(error.code)||attempt>=2)throw error;signal?.throwIfAborted();}
  };
  if(command.action!=='task.save')return await perform();
  // A retained receipt is authoritative even when its former sources are now
  // unavailable. The normal transaction still verifies its exact fingerprint.
  const retained=()=>this.domains.run([],async(_get,{research,registry,inspect})=>new ProjectModuleIdentities(research,registry,inspect).locate('command',command.commandId),{signal,check});
  if(await retained())return await perform();
  try{return await withPlanningTaskAdmission(this.storage,this.namespaceId,command,{sourceAccess:taskSourceAccess,check,signal},perform);}
  catch(error){
   // A simultaneous exact retry may commit after preflight. Re-enter the same
   // authoritative receipt transaction without requiring former source access.
   signal?.throwIfAborted();await check?.();if(await retained())return await perform();throw error;
  }
  }finally{await references?.close();}
 }
}
