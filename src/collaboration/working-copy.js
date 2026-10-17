import {matchingSharedStructure} from './configuration-transfer.js';
import {AppError} from '../errors.js';
import {identityHash} from './identity.js';
import {selectedMetadata} from './selection.js';
import {ExchangeParts} from './exchange-parts.js';

export const workingFile='.observanda/collaboration/working.json';
export const receiptPath=id=>'.observanda/collaboration/receipts/'+id+'.json';
const valid=(value,code='COLLABORATION_DENIED')=>{if(!value)throw new AppError(code);};

export function matchesWorkingCopy(working,selection){
 const base=working?.selection;
 return !!base&&selection.kind==='offer'&&base.metadata.id===selection.metadata.id&&base.owner.identity.id===selection.owner.identity.id&&base.recipient.identity.id===selection.recipient.identity.id&&base.grant.id===selection.grant.id&&base.grant.organizationId===selection.grant.organizationId&&base.grant.principalId===selection.grant.principalId;
}

// A received authority edition is monotonic even when the owner's clock moves
// backwards. Old, already delivered files cannot reset a collaborator's base.
export function requireNewEdition(working,selection){
 valid(matchesWorkingCopy(working,selection));
 valid(selection.edition>working.selection.edition&&selection.grant.generation>=working.selection.grant.generation,'STALE');
}

export async function updatedStructure(current,base,selection,{workspace,retainedBookIds=null}={}){
 const ids=base.metadata.notebooks.map(n=>n.id);
 const incomingBooks=new Set(selection.metadata.notebooks.map(n=>n.id));
 valid(current.notebooks.every(n=>!incomingBooks.has(n.id)||ids.includes(n.id)),'COLLABORATION_SCOPE');
 const projected=selectedMetadata(current,ids);projected.updatedAt=base.metadata.updatedAt;
 valid(await matchingSharedStructure(workspace,projected,base.metadata),'COLLABORATION_STRUCTURE');
 const next=structuredClone(current),books=new Set(ids),projects=new Set(base.metadata.projects.map(p=>p.id));
 next.title=selection.metadata.title;
 next.notebooks=[...current.notebooks.filter(n=>!incomingBooks.has(n.id)&&(!books.has(n.id)||retainedBookIds===null||retainedBookIds.has(n.id))),...structuredClone(selection.metadata.notebooks)];
 const incomingProjects=new Set(selection.metadata.projects.map(p=>p.id)),keepProject=id=>!incomingProjects.has(id)&&(!projects.has(id)||next.notebooks.some(n=>n.projectId===id)||current.projects.some(p=>p.parentId===id&&!projects.has(p.id)));
 next.projects=[...current.projects.filter(p=>keepProject(p.id)),...structuredClone(selection.metadata.projects)];
 return next;
}

export async function retainWorkingBase(workspace,parts,selection){
 const retain=()=>retainWorkingBaseFromSnapshot(workspace,parts,selection);
 return await parts.workspace.storageKind()==='catalogue'?parts.workspace.catalogue(retain):retain();
}
async function retainWorkingBaseFromSnapshot(workspace,parts,selection){
 const base=new ExchangeParts(workspace,selection.id),old=await workspace.readMetadata(base.prefix+'/head.json',8192);
 if(old===null){const head=await parts.open();for await(const item of parts.entries())await base.add(item);await base.finish({direction:'base',selectionHash:identityHash(selection),...(head.attestation?{attestation:head.attestation,sender:head.sender,signatureHash:head.signatureHash}:{})});}
 else{await base.open();valid(identityHash(await base.value('description','selection'))===identityHash(selection),'COLLABORATION_DAMAGED');}
 await workspace.writeMetadata(workingFile,JSON.stringify({version:1,selection,receivedAt:new Date().toISOString()}));
}
