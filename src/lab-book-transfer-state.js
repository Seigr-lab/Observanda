// The containing project stores command identities, never sibling book payloads.
import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const kinds=['copy','export'];
export const bookTransferComplete=value=>!value||['complete','cancelled'].includes(value.phase);
export class LabBookTransferState{
 constructor(project,labBookId,kind){if(!researchId(labBookId)||!kinds.includes(kind))throw new AppError('INVALID');this.project=project;this.labBookId=labBookId;this.kind=kind;this.file=path.join(project.root,'.observanda/lab-book-transfers',labBookId+'-'+kind+'.obsv');}
 async read(){
  const stat=await assertRegular(this.file,{missing:true});if(!stat)return null;if(stat.size>16384)throw new AppError('STORAGE_COPY');
  let value;try{value=JSON.parse(await this.project.readFile(this.file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
  if(value?.version!==1||value.projectId!==this.project.projectId||value.labBookId!==this.labBookId||value.kind!==this.kind||![value.id,value.namespaceId,value.vaultId].every(researchId)||!['copying','complete','cancelled'].includes(value.phase)||![value.source,value.destination].every(root=>typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root&&root!==path.parse(root).root))throw new AppError('STORAGE_COPY');return value;
 }
 async save(value){await privateDirectory(this.project.root,'.observanda/lab-book-transfers');await this.project.writeFile(this.file,serialize(value));}
}
export async function assertBookTransfersComplete(project,labBookId,{except}={}){
 for(const kind of kinds)if(kind!==except&&!bookTransferComplete(await new LabBookTransferState(project,labBookId,kind).read()))throw new AppError('LAB_BOOK_TRANSFER_PENDING');
}
export async function assertProjectBookTransfersComplete(project){
 const root=path.join(project.root,'.observanda/lab-book-transfers');if(!await assertRegular(root,{directory:true,missing:true}))return;
 for await(const entry of await opendir(root)){const match=/^([a-f0-9-]{36})-(copy|export)\.obsv$/.exec(entry.name);if(match&&!bookTransferComplete(await new LabBookTransferState(project,match[1],match[2]).read()))throw new AppError('LAB_BOOK_TRANSFER_PENDING');}
}
