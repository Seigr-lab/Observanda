// A migrated template keeps its exact earlier command receipts. Only an
// explicitly transferred receipt may recognize the former workspace address.
import {projectDomainSourceMatches} from './project-domain-origin.js';
import {packageDigest} from './record-starter-package.js';
import {digest} from './storage-format.js';
export const starterReceiptOriginKey=file=>'project:starter-receipt-origin:'+digest(file);
export const starterReceiptFingerprint=(value,binding='receipt')=>packageDigest(binding==='capture'?{request:value.request,target:value.target}:value);
export async function starterRequestMatches(workspace,command,prior,field,file){
 if(packageDigest(command)===prior[field])return true;
 if(!workspace.projectId)return false;
 return workspace.catalogue(async store=>{
  const origin=await store.object(starterReceiptOriginKey(file)),migration=await store.object('project:research-migration');
  if(!origin||origin.version!==1||origin.file!==file||origin.projectId!==workspace.projectId||origin.namespaceId!==command.workspaceId)return false;
  if(!['receipt','capture'].includes(origin.binding)||origin.fingerprint!==starterReceiptFingerprint(prior,origin.binding)||origin.field!==field)return false;
  if(origin.binding==='capture'&&(file!=='.observanda/record-starters/captures/'+command.id+'.json'||!Object.hasOwn(command,'snapshotId')))return false;
  if(migration?.version!==1||migration.projectId!==workspace.projectId||migration.namespaceId!==origin.namespaceId||migration.sourceNamespace!==origin.sourceNamespace||!await projectDomainSourceMatches(store,'starters',origin,migration))return false;
  if((await store.snapshot()).metadata.id!==command.workspaceId)return false;
  const previous={...command,workspaceId:origin.sourceNamespace};
  if(Object.hasOwn(command,'snapshotId')){if(command.snapshotId!==origin.snapshotId)return false;previous.snapshotId=origin.sourceSnapshotId;}
  return packageDigest(previous)===prior[field];
 });
}
