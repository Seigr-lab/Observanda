import {recordOrigin,recordOrigins} from './record-owner-provenance.js';
// A former address is accepted only for an identity explicitly transferred to
// this catalogue. Sharing an old namespace alone grants neither ownership nor
// access to another owner's records or evidence.
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export async function referenceNamespaceMatches(store,ref){
 const current=(await store.snapshot()).metadata.id;
 if(!ref?.workspaceId||ref.workspaceId===current)return true;
 return !!await recordOrigin(store,ref);
}
export async function workspaceReferenceNamespaceMatches(workspace,ref){
 if(!ref?.workspaceId)return true;
 return workspace.catalogue(store=>referenceNamespaceMatches(store,ref));
}

// Equivalent addresses are granted per identity. A foreign namespace without
// its ownership witness remains a foreign address, even when IDs coincide.
export async function recordReferenceNamespaces(store,reference){
 const current=(await store.snapshot()).metadata.id,ref={...reference,kind:'record'};
 if(ref.workspaceId!==current&&!await referenceNamespaceMatches(store,ref))return [ref.workspaceId];
 return recordNamespaces(store,ref,{current,empty:false});
}
async function recordNamespaces(store,ref,{current,empty}){
 if(!researchId(ref.id))throw new AppError('INVALID');
 const names=new Set([current]);
 if(!empty)for await(const origin of recordOrigins(store,'record',ref.id))names.add(origin.sourceNamespace);return [...names];
}

// Carry every authenticated former owner of this identity when its content
// moves again.
export async function* referenceSourceOwners(store,ref){
 for await(const origin of recordOrigins(store,ref.kind,ref.id))yield origin.sourceOwner;
}
