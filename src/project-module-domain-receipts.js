import {projectModuleInputEpochMatches} from './project-module-input-epochs.js';
// Legacy command bodies and fingerprints remain unchanged. Ordered ID metadata
// reconstructs an original event from its domain fragments without a third copy.
import {projectDomainSourceMatches} from './project-domain-origin.js';
import {moduleReceiptOriginKey,moduleReceiptMatches} from './project-module-receipts.js';
import {moduleEventHash} from './project-module-identities.js';
import {digest,serialize} from './storage-format.js';
import {uuid} from './modules/validation.js';
import {AppError} from './errors.js';
export async function projectModuleOriginEvent(research,receipt,fragments){
 const origin=await research.object(moduleReceiptOriginKey(receipt.id)),fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
 if(receipt.originHash===null){if(origin)fail();return null;}
 if(!origin||digest(serialize(origin))!==receipt.originHash)fail();
 if(origin.layout!=='project-domains-v1'||origin.version!==1||origin.commandId!==receipt.id||origin.projectId!==research.workspace.projectId||origin.namespaceId!==(await research.snapshot()).metadata.id||!Array.isArray(origin.changeOrder)||!origin.changeOrder.length||!origin.changeOrder.every(uuid)||new Set(origin.changeOrder).size!==origin.changeOrder.length)fail();
 const changes=new Map();for(const {event} of fragments)for(const entity of event.changes){if(changes.has(entity.id))fail();changes.set(entity.id,entity);}
 if(changes.size!==origin.changeOrder.length||origin.changeOrder.some(id=>!changes.has(id)))fail();
 const event={...fragments[0].event,changes:origin.changeOrder.map(id=>changes.get(id))};
 if(moduleEventHash(event)!==origin.eventHash)fail();
 const migration=await research.object('project:module-migration'),source=await research.object('project:research-migration');
 for(const proof of [migration,source])if(proof?.version!==1||proof.projectId!==origin.projectId||proof.namespaceId!==origin.namespaceId||proof.sourceNamespace!==origin.sourceNamespace||!await projectDomainSourceMatches(research,'modules',proof,source))fail();
 if(!await projectDomainSourceMatches(research,'modules',origin,source))fail();
 if(!await projectModuleInputEpochMatches(research,origin,migration))fail();return event;
}
export async function projectModuleDomainReceiptMatches(research,command,receipt,fragments,fingerprint){
 if(receipt.fingerprint===fingerprint)return true;
 const original=await projectModuleOriginEvent(research,receipt,fragments);return !!original&&await moduleReceiptMatches(research,command,original,fingerprint);
}
