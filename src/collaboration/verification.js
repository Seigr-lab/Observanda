import {verifyPackageConfigurations} from './configuration-transfer.js';
import {Organizations} from './organizations.js';
import {ContentAccess} from './content-access.js';
import {ExchangeParts} from './exchange-parts.js';
import {packageSelection} from './research-package.js';
import {identityHash,verifyOrganizationCommand} from './identity.js';
import {createHash} from 'node:crypto';
import {manifestEntry} from './exchange-stream.js';
import {validateSelection} from './selection.js';
import {AppError} from '../errors.js';

// Completed encrypted exchanges are part of a restorable workspace, including
// the exact base required to review a collaborator's later return file.
export async function verifyCollaboration(workspace,verified){
 await new Organizations(workspace).load();await new ContentAccess(workspace).load();
 const raw=await workspace.readMetadata('.observanda/collaboration/working.json',2*1024*1024);
 if(raw){const working=JSON.parse(raw),selection=validateSelection(working.selection);if(working.version!==1||selection.kind!=='offer'||selection.metadata.id!==await workspace.catalogue(async store=>(await store.snapshot()).metadata.id))throw new AppError('COLLABORATION_DAMAGED');const base=new ExchangeParts(workspace,selection.id);await base.open();if(identityHash(await packageSelection(base))!==identityHash(selection))throw new AppError('COLLABORATION_DAMAGED');}
 for await(const id of workspace.metadataNames('.observanda/collaboration/staging')){
  if(!/^[a-f0-9-]{36}$/.test(id))throw new AppError('COLLABORATION_DAMAGED');const parts=new ExchangeParts(workspace,id);
  if(await workspace.readMetadata(parts.prefix+'/head.json',8192)===null)continue;
  const head=await parts.open(),selection=await packageSelection(parts);if(head.selectionHash!==identityHash(selection))throw new AppError('COLLABORATION_DAMAGED');
  const manifest=createHash('sha256');
  for await(const item of parts.items()){
   manifest.update(manifestEntry(item));
   const pointer=await parts.descriptor(item.kind,item.name);if(identityHash(pointer)!==identityHash(item))throw new AppError('COLLABORATION_DAMAGED');
   const content=parts.content(item);await verified.once(['collaboration-file',parts.id,item.index,item.size,item.sha256],()=>content.verify());
  }
  await verified.once(['collaboration-configurations',parts.id,head.selectionHash],()=>verifyPackageConfigurations(parts,selection.metadata));
  if(head.direction==='incoming'||head.direction==='base'){
   if(!head.attestation)throw new AppError('COLLABORATION_DAMAGED');
   const signed=verifyOrganizationCommand(head.attestation),sender=selection.kind==='offer'?selection.owner.identity.id:selection.recipient.identity.id;
   if(signed.kind!=='collaboration.package'||signed.entries!==parts.count||signed.manifestHash!==manifest.digest('hex')||head.sender!==sender||head.attestation.identity.id!==sender||head.signatureHash!==identityHash(head.attestation))throw new AppError('COLLABORATION_DAMAGED');
  }
 }
 for await(const name of workspace.metadataNames('.observanda/collaboration/received')){
  if(!/^[a-f0-9-]{36}\.json$/.test(name))throw new AppError('COLLABORATION_DAMAGED');
  const receipt=JSON.parse(await workspace.readMetadata('.observanda/collaboration/received/'+name,8192)),parts=new ExchangeParts(workspace,receipt.id),head=await parts.open(),selection=await packageSelection(parts);
  if(head.direction!=='incoming'||selection.id+'.json'!==name||receipt.sender!==head.sender||receipt.selectionHash!==head.selectionHash||receipt.manifestHash!==head.attestation?.value?.manifestHash)throw new AppError('COLLABORATION_DAMAGED');
 }
}
