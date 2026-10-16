// Persist one prepared module event inside the caller's existing owner transaction.
import {projectModuleDomainReceiptMatches} from './project-module-domain-receipts.js';
import {moduleEventHash} from './project-module-identities.js';
import {moduleDomain} from './modules/domains.js';
import {admitModuleChanges} from './modules/command-capacity.js';
import {AppError} from './errors.js';
export async function replayProjectModuleEvent({owner,identities,federation,plan,command,fingerprint,receipt}){
 const events=await identities.fragments(receipt),baseRevisions=Object.fromEntries([...federation.owners].map(([domain,o])=>[domain,o.head.revision]));
 if(receipt.primary!==plan.primary||receipt.write.join()!==plan.write.join()||!await projectModuleDomainReceiptMatches(identities.research,command,receipt,events,fingerprint)||receipt.fingerprint===fingerprint&&receipt.read.join()!==plan.read.join())throw new AppError('MODULE_REPLAY');
 const entities=[];for(const {event} of events){owner.validateEvent(event);for(const e of event.changes){const current=await federation.selected(federation.head,e.id);if(!current)throw new AppError('CATALOGUE_DAMAGED');owner.validateEntity(current);entities.push(current);}}
 return {workspaceId:command.workspaceId,baseRevisions,revisions:{...baseRevisions},entities,changedIds:entities.map(e=>e.id),replayed:true};
}
export async function writeProjectModuleEvent({owner,identities,federation,plan,command,fingerprint,event}){
 owner.validateEvent(event);const changes=new Map(),baseRevisions=Object.fromEntries([...federation.owners].map(([domain,o])=>[domain,o.head.revision]));
 for(const entity of event.changes){const domain=moduleDomain(entity.type);if(!plan.write.includes(domain))throw new AppError('MODULE_FORMAT');if(!changes.has(domain))changes.set(domain,[]);changes.get(domain).push(entity);}
 if([...changes.keys()].sort().join()!==plan.write.join())throw new AppError('MODULE_FORMAT');const events=[],fragments=[],revisions={...baseRevisions};
 for(const domain of [...changes.keys()].sort()){
  const entities=changes.get(domain),fragment={...event,changes:entities},current=federation.owners.get(domain);await admitModuleChanges(current.catalogue,current.head,command.workspaceId,entities,fragment);
  for(const entity of entities){const existing=await identities.locate('entity',entity.id);if(existing&&existing.domain!==domain)throw new AppError('MODULE_CHANGED');await identities.claim('entity',entity.id,{domain});}
  events.push({domain,event:fragment});fragments.push({domain,ordinal:current.head.revision+1,hash:moduleEventHash(fragment)});
 }
 await identities.claim('command',command.commandId,{primary:plan.primary,fingerprint,originHash:null,action:event.action,eventId:event.id,at:event.at,read:plan.read,write:plan.write,fragments});
 for(const {domain,event:fragment} of events){const current=federation.owners.get(domain);await current.catalogue.writeChanges(current.head,fragment.changes,fragment);revisions[domain]++;}
 return {workspaceId:command.workspaceId,baseRevisions,revisions,entities:event.changes,changedIds:event.changes.map(e=>e.id),replayed:false};
}
