import {configurationBootstrap,hasSharedConfigurations,matchingSharedStructure} from './configuration-transfer.js';
import {AppError} from '../errors.js';
import {uuid} from '../modules/validation.js';
import {createWorkspaceAccess,takeCreatedVault} from '../access.js';
import {clearVault} from '../encryption.js';
import {initializeLocation} from '../locations.js';
import {ExchangeIdentity,exchangeContact} from './exchange-identity.js';
import {ExchangeParts} from './exchange-parts.js';
import {readExchange,writeExchange,exchangeDeclaration} from './exchange-stream.js';
import {ContentAccess} from './content-access.js';
import {requireAdministrator} from './organization-policy.js';
import {selectedMetadata,validateSelection} from './selection.js';
import {collectResearch,packageSelection,populateSharedWorkspace} from './research-package.js';
import {identityHash} from './identity.js';
import {workingFile,retainWorkingBase} from './working-copy.js';
import {withStagingAuthority,recoverStaging} from '../staging-reservations.js';
import {declaredStagingBytes,STAGING_FREE_BYTES} from '../staging-reservation-model.js';
import {onVaultRetire} from '../vault-lifecycle.js';

const valid=(condition,code='COLLABORATION_DENIED')=>{if(!condition)throw new AppError(code);};
class RepeatedExchange extends Error{constructor(summary){super('Previously received exchange');this.summary=summary;}}

export class ResearchExchange{
 constructor(workspace,device){this.workspace=workspace;this.device=device;this.identity=new ExchangeIdentity(device);this.access=new ContentAccess(workspace);}
 async contact(){return this.identity.contact();}
 async prepareOffer({grantId,contact}){
  valid(uuid(grantId),'INVALID');exchangeContact(contact);
  const parts=new ExchangeParts(this.workspace);return this.workspace.withLock(async()=>{
   const authority=await this.access.organizations.load(),actor=this.access.organizations.principal(authority,await this.identity.signer.public()),principalId=this.access.organizations.principal(authority,contact.identity);
   const state=await this.access.load(),grant=state.grants.find(g=>g.id===grantId);valid(grant);requireAdministrator(authority,grant.organizationId,actor);
   const {notebookIds}=await this.access.authorize({organizationId:grant.organizationId,principalId,grantId}),{metadata}=await this.workspace.outline();
   const editionFile='.observanda/collaboration/editions/'+grant.id+'.json',editionRaw=await this.workspace.readMetadata(editionFile,1024),edition=editionRaw?JSON.parse(editionRaw).edition+1:1;valid(Number.isSafeInteger(edition)&&edition>=1,'COLLABORATION_DAMAGED');
   const selection={version:1,kind:'offer',id:parts.id,baseId:null,edition,createdAt:new Date().toISOString(),grant:{id:grant.id,generation:grant.generation,organizationId:grant.organizationId,principalId,role:grant.role},owner:await this.contact(),recipient:contact,metadata:selectedMetadata(metadata,notebookIds)};
   if(hasSharedConfigurations(selection.metadata))selection.version=2;
   await parts.add({kind:'description',name:'selection',content:JSON.stringify(selection)});await collectResearch(this.workspace,selection.metadata,parts);
   await parts.finish({direction:'outgoing',selectionHash:identityHash(selection)});
   await this.workspace.writeMetadata(editionFile,JSON.stringify({edition}));
   return this.summary(parts,selection);
  }).catch(async error=>{await parts.discardUncommitted();throw error;});
 }
 summary(parts,selection){return {id:parts.id,kind:selection.kind,createdAt:selection.createdAt,role:selection.grant.role,notebooks:selection.metadata.notebooks.map(({id,title})=>({id,title})),bytes:parts.bytes,parts:parts.count};}
 async currentGrant(selection,{write=false}={}){
  const authority=await this.access.organizations.load(),principalId=this.access.organizations.principal(authority,selection.recipient.identity);valid(principalId===selection.grant.principalId);
  const result=await this.access.authorize({organizationId:selection.grant.organizationId,principalId,grantId:selection.grant.id,generation:selection.grant.generation,write});
  valid(selection.metadata.notebooks.every(n=>result.notebookIds.includes(n.id)));return result;
 }
 async outgoing(id){
  const parts=new ExchangeParts(this.workspace,id),head=await parts.open(),selection=await packageSelection(parts);valid(head.direction==='outgoing');
  if(selection.kind==='offer')await this.currentGrant(selection);
  else{const working=await this.working();valid(working&&working.selection.id===selection.baseId&&working.selection.grant.role==='editor');}
  const recipient=selection.kind==='offer'?selection.recipient:selection.owner;
  const declaration=await exchangeDeclaration(parts.items(),selection);
  return writeExchange(this.identity,recipient,parts.entries(),{id:selection.id,declaration});
 }
 async receive(source,{signal}={}){
  const workspace=this.workspace;if(!workspace.vault?.key)throw new AppError('ACCESS_LOCKED');const controller=new AbortController();signal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let drained;const done=new Promise(resolve=>{drained=resolve;}),retire=onVaultRetire(workspace.vault,()=>{controller.abort(new AppError('ACCESS_LOCKED'));return done;});
  try{return await withStagingAuthority(workspace,async authority=>{
   let claim,admitted,sender;const parts=new ExchangeParts(workspace,undefined,{capacity:options=>{if(!claim)throw new AppError('COLLABORATION_PACKAGE');return claim.capacity(options);},write:operation=>workspace.withLock(async()=>{await claim.check();await this.authorizeIncoming(admitted,sender);return operation();})});
   try{
    const result=await readExchange(this.identity,source,(info,content,options)=>parts.receive(info,content,{...options,reserveBytes:STAGING_FREE_BYTES}),{signal,requireDeclaration:true,authorizeDeclaration:async declaration=>{
     admitted=validateSelection(declaration.declaration.selection);sender=declaration.sender;valid(admitted.id===declaration.id,'COLLABORATION_PACKAGE');await workspace.withLock(()=>this.authorizeIncoming(admitted,sender));await recoverStaging(workspace,{signal});
     await workspace.withLock(async()=>{await this.authorizeIncoming(admitted,sender);claim=await authority.reserve({id:parts.id,principalId:admitted.grant.principalId,ownerId:(await workspace.outline()).metadata.id,grantGeneration:admitted.grant.generation,entries:declaration.declaration.entries,expectedBytes:declaredStagingBytes(declaration.declaration.bytes,declaration.declaration.entries),expiresAt:declaration.expiresAt});});
    }}),selection=await packageSelection(parts);valid(selection.id===result.id,'COLLABORATION_PACKAGE');await claim.preparing();
    const summary=await workspace.withLock(async()=>{
     await claim.check();await this.authorizeIncoming(selection,result.sender);
     // Complete stream attestation and current authority precede publication.
     // The claim remains live until this database transaction has committed.
     const receiptPath='.observanda/collaboration/received/'+selection.id+'.json',raw=await workspace.readMetadata(receiptPath,8192),receipt={id:parts.id,sender:result.sender.id,selectionHash:identityHash(selection),manifestHash:result.attestation.value.manifestHash};
     if(raw){const previous=JSON.parse(raw);valid(previous.sender===receipt.sender&&previous.selectionHash===receipt.selectionHash&&previous.manifestHash===receipt.manifestHash,'COLLABORATION_PACKAGE');const retained=new ExchangeParts(workspace,previous.id);await retained.open();throw new RepeatedExchange(this.summary(retained,selection));}
     await parts.finish({direction:'incoming',selectionHash:receipt.selectionHash,sender:result.sender.id,signatureHash:result.signatureHash,attestation:result.attestation},{write:operation=>operation()});await workspace.writeMetadata(receiptPath,JSON.stringify(receipt));return this.summary(parts,selection);
    });await claim.committed();await recoverStaging(workspace,{id:parts.id,signal});return summary;
   }catch(error){
    await claim?.close();if(workspace.vault?.key)await recoverStaging(workspace,{id:parts.id});
    if(error instanceof RepeatedExchange)return {...error.summary,replayed:true};throw error;
   }finally{await claim?.close();}
  },{signal});}finally{retire();drained();}
 }
 async authorizeIncoming(selection,sender){
   const local=(await this.identity.signer.public()).id;
   if(selection.kind==='offer'){
    valid(selection.recipient.identity.id===local&&selection.owner.identity.id===sender.id);
    let enrolled=false;
    for await(const file of this.workspace.metadataNames('.observanda/organizations/enrollments')){
     const e=JSON.parse(await this.workspace.readMetadata('.observanda/organizations/enrollments/'+file,20000));
     if(e.acceptedAt&&e.authorityFingerprint===sender.id&&e.authorityId===selection.metadata.id&&e.organizationId===selection.grant.organizationId&&e.recipient===local&&e.principalId===selection.grant.principalId)enrolled=true;
    }
    // Subsequent editions can also arrive in an existing working copy.
    const working=await this.working();if(working&&working.selection.owner.identity.id===sender.id&&working.selection.grant.principalId===selection.grant.principalId&&working.selection.metadata.id===selection.metadata.id)enrolled=true;
    valid(enrolled);
   }else{
    valid(selection.owner.identity.id===local&&selection.recipient.identity.id===sender.id);
    const base=new ExchangeParts(this.workspace,selection.baseId);await base.open();const offered=await packageSelection(base);
    valid(offered.kind==='offer'&&offered.edition===selection.edition&&identityHash(offered.grant)===identityHash(selection.grant)&&identityHash(offered.recipient)===identityHash(selection.recipient)&&identityHash(offered.owner)===identityHash(selection.owner)&&identityHash(offered.metadata)===identityHash(selection.metadata));
    await this.currentGrant(offered,{write:true});
   }
 }
 async acceptCopy(id,destination){
  const parts=new ExchangeParts(this.workspace,id),head=await parts.open(),selection=await packageSelection(parts);valid(head.direction==='incoming'&&selection.kind==='offer');
  valid(selection.recipient.identity.id===(await this.identity.signer.public()).id);
  const access=await createWorkspaceAccess('', '',this.device),vault=takeCreatedVault(access);
  try{
   return await initializeLocation(destination,configurationBootstrap(selection.metadata),access,vault,{populate:async workspace=>{
    await populateSharedWorkspace(workspace,parts);
    await retainWorkingBase(workspace,parts,selection);
   }});
  }finally{await clearVault(vault);}
 }
 async working(){const raw=await this.workspace.readMetadata(workingFile,2*1024*1024);return raw?JSON.parse(raw):null;}
 async prepareChanges(){
  const parts=new ExchangeParts(this.workspace);return this.workspace.withLock(async()=>{
   const working=await this.working();valid(working&&working.selection.grant.role==='editor');valid(working.selection.recipient.identity.id===(await this.identity.signer.public()).id);
   const {metadata}=await this.workspace.outline();valid(metadata.id===working.selection.metadata.id,'WORKSPACE_CHANGED');
   const selection={...working.selection,kind:'changes',id:parts.id,baseId:working.selection.id,createdAt:new Date().toISOString()};
   // The owner controls structure and publishing. Changed research uses the
   // original shared structure, making unknown/moved books a review error.
   valid(await matchingSharedStructure(this.workspace,{...selectedMetadata(metadata,selection.metadata.notebooks.map(n=>n.id)),updatedAt:selection.metadata.updatedAt},selection.metadata),'COLLABORATION_STRUCTURE');
   await parts.add({kind:'description',name:'selection',content:JSON.stringify(selection)});await collectResearch(this.workspace,selection.metadata,parts);await parts.finish({direction:'outgoing',selectionHash:identityHash(selection)});return this.summary(parts,selection);
  }).catch(async error=>{await parts.discardUncommitted();throw error;});
 }
}
