// Read the authenticated ownership receipt without importing transfer engines.
import path from 'node:path';
import {assertRegular} from './storage.js';
import {researchId} from './web/research-reference.js';
import {validProjectSourceAuthority} from './project-source-authority.js';
import {validTableRef} from './retained-table-index.js';
import {AppError} from './errors.js';
export class ProjectAdoptionReceipt{
 constructor(source,target,id){
  if(source.projectId||!researchId(target.projectId)||!researchId(id)||source.root===target.root||source.vault?.id===target.vault?.id)throw new AppError('INVALID');
  this.source=source;this.target=target;this.id=id;this.file=path.join(source.root,'.observanda','project-adoptions',id+'.obsv');
 }
 async saved(){
  if(!await assertRegular(path.dirname(this.file),{directory:true,missing:true}))return null;
  const stat=await assertRegular(this.file,{missing:true});if(!stat)return null;if(stat.size>16384)throw new AppError('FORMAT');let value;
  try{value=JSON.parse(await this.source.readFile(this.file,'utf8'));}catch(error){if(error instanceof SyntaxError)throw new AppError('FORMAT');throw error;}
  if(!value||Object.keys(value).sort().join()!=='aliases,entry,receipt,version'||value.version!==1||!validProjectSourceAuthority(value.receipt)||value.receipt.operationId!==this.id||value.receipt.projectId!==this.target.projectId||value.entry?.projectId!==value.receipt.projectId||value.entry.namespaceId!==value.receipt.namespaceId||value.entry.vaultId!==value.receipt.vaultId||!validTableRef(value.aliases))throw new AppError('FORMAT');return value;
 }
}
