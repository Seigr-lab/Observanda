// Every copied owner retains its own database and directory identities.
import path from 'node:path';
import {researchId} from './web/research-reference.js';
import {validDatabaseRetention} from './workspace-database-retention.js';
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys;
export const validPlacementIdentity=value=>exact(value,'dev,ino')&&Object.values(value).every(part=>typeof part==='string'&&/^\d+$/.test(part));
export function placementOwners(value){
 const owners=[{kind:'project',ownerId:value.projectId,namespaceId:value.namespaceId,vaultId:value.vaultId,relative:''}];
 const books=(parent,items)=>{for(const book of items??[])owners.push({kind:'lab-book',ownerId:book.labBookId,namespaceId:book.namespaceId,vaultId:book.vaultId,relative:path.posix.join(parent,book.directory)});};
 books('',value.rootBooks?.books);
 for(const project of value.projects??[]){owners.push({kind:'project',ownerId:project.projectId,namespaceId:project.namespaceId,vaultId:project.vaultId,relative:project.relative});books(project.relative,project.books);}
 return owners.sort((a,b)=>a.relative.split('/').length-b.relative.split('/').length||(a.relative<b.relative?-1:a.relative>b.relative?1:0));
}
export function validProjectPlacementTransfer(value){
 if(value.version===1)return value.transfer===undefined&&['prepared','frozen','moved','complete','cancelling','cancelled'].includes(value.phase);
 if(value.version!==2||!value.placement||value.cancelReason!==undefined||!['copying','moved','registered','retiring','retired','complete'].includes(value.phase)||!exact(value.transfer,'owners')||!Array.isArray(value.transfer.owners))return false;
 const expected=placementOwners(value),ids=new Set();if(expected.length!==value.transfer.owners.length)return false;
 return value.transfer.owners.every((owner,index)=>{
  if(!owner||Object.keys(expected[index]).some(key=>owner[key]!==expected[index][key])||!researchId(owner.id)||ids.has(owner.id)||!researchId(owner.sourceId)||!validPlacementIdentity(owner.sourceIdentity))return false;ids.add(owner.id);
  const complete=owner.destinationId!==undefined;
  if(!complete&&value.phase!=='copying')return false;
  return exact(owner,complete?'destinationId,destinationIdentity,id,kind,namespaceId,ownerId,relative,retention,sourceId,sourceIdentity,vaultId':'id,kind,namespaceId,ownerId,relative,sourceId,sourceIdentity,vaultId')&&(!complete||researchId(owner.destinationId)&&owner.destinationId!==owner.sourceId&&validPlacementIdentity(owner.destinationIdentity)&&validDatabaseRetention(owner.retention));
 });
}
