// Read authenticated conversion receipts without loading the maintenance engine.
import path from 'node:path';
import {assertRegular} from './storage.js';
import {ACCESS_LIMIT} from './security/keyring.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const limit=ACCESS_LIMIT+16384;
const fields='fingerprint,id,namespaceId,phase,projectId,sourceNamespace,vaultId,version';
const hasGrant=value=>value.phase==='prepared'||value.phase==='cleanup'&&value.version<4;
export const projectCleanupIntent=value=>Object.fromEntries(fields.split(',').map(key=>[key,key==='version'?4:key==='phase'?'cleanup':value[key]]));
export const validConversionRoot=root=>typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root&&root!==path.parse(root).root;
export class ProjectConversionJournal{
 constructor(registry){this.registry=registry;this.workspace=registry.workspace;}
 file(id,complete=false){if(!researchId(id))throw new AppError('INVALID');return path.join(this.workspace.root,'.observanda',complete?'project-converted':'project-conversions',id+'.obsv');}
 async read(id){
  for(const complete of [true,false]){
   const file=this.file(id,complete);if(!await assertRegular(path.dirname(file),{directory:true,missing:true}))continue;const stat=await assertRegular(file,{missing:true});if(!stat)continue;if(stat.size>limit+256)throw new AppError('FORMAT');let value;
   try{value=JSON.parse(await this.workspace.readFile(file,'utf8'));}catch(error){if(error instanceof SyntaxError)throw new AppError('FORMAT');throw error;}
   if(!value||Object.keys(value).sort().join()!==(hasGrant(value)?'access,fingerprint,id,namespaceId,phase,projectId,root,sourceNamespace,vaultId,version':value.version===3&&value.phase==='cleaned'?'cleanupRevision,'+fields:fields)||complete&&!['adopted','cleaned'].includes(value.phase)||![1,2,3,4].includes(value.version)||value.version===4&&value.phase!=='cleanup'||value.version===3&&value.phase==='cleaned'&&(!Number.isSafeInteger(value.cleanupRevision)||value.cleanupRevision<1)||value.id!==id||!researchId(value.projectId)||!researchId(value.namespaceId)||!researchId(value.vaultId)||!revisionId(value.fingerprint)||value.sourceNamespace!==this.registry.workspaceId||!(value.version===1?['prepared','adopted']:['prepared','cleanup','cleaned']).includes(value.phase)||hasGrant(value)&&(!validConversionRoot(value.root)||value.access?.vaultId!==value.vaultId||value.access.formatVersion!==3))throw new AppError('FORMAT');
   return {value,file,complete};
  }
  return null;
 }
}
