// Immutable, encrypted ownership changes link each project's revision tokens.
// A missing older link is an explicit boundary, never proof of unchanged owners.
import path from 'node:path';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const base='.observanda/project-owner-history',domains=new Set(['media','mediaImport','starter','starterUpload','module','font','review']);
const token=value=>value==='new'||researchId(value),invalid=()=>{throw new AppError('FORMAT');};
const validChange=value=>value===null||value&&Object.keys(value).sort().join()==='before,domain,id'&&domains.has(value.domain)&&(value.domain==='font'?/^custom-[a-f0-9]{64}$/.test(value.id):researchId(value.id))&&(value.before==='new'||revisionId(value.before));
export class ProjectOwnerHistory{
 constructor(workspace,namespaceId){if(workspace.projectId||!researchId(namespaceId))throw new AppError('INVALID');this.workspace=workspace;this.namespaceId=namespaceId;}
 file(projectId,revision){if(!researchId(projectId)||!researchId(revision))throw new AppError('INVALID');return path.join(this.workspace.root,base,projectId,revision+'.obsv');}
 async read(projectId,revision){
  const file=this.file(projectId,revision);await this.workspace.requireStorageKey();
  for(const part of ['.observanda',base,base+'/'+projectId])if(!await assertRegular(path.join(this.workspace.root,part),{missing:true,directory:true}))return null;
  const stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>4096)invalid();let value;try{value=JSON.parse(await this.workspace.readFile(file,'utf8'));}catch{invalid();}
  if(!value||Object.keys(value).sort().join()!=='change,ordinal,previous,projectId,revision,sourceNamespace,version'||value.version!==1||value.projectId!==projectId||value.sourceNamespace!==this.namespaceId||value.revision!==revision||!token(value.previous)||value.previous===revision||!Number.isSafeInteger(value.ordinal)||value.ordinal<1||value.previous==='new'&&value.ordinal!==1||!validChange(value.change))invalid();return value;
 }
 async append(projectId,previous,revision,change=null){
  if(!token(previous)||!validChange(change))throw new AppError('INVALID');const file=this.file(projectId,revision),prior=previous==='new'?null:await this.read(projectId,previous),ordinal=(prior?.ordinal??0)+1;if(!Number.isSafeInteger(ordinal))throw new AppError('LIMIT');
  await privateDirectory(this.workspace.root,base+'/'+projectId);if(await assertRegular(file,{missing:true}))throw new AppError('EXISTS');
  await this.workspace.writeFile(file,serialize({version:1,projectId,sourceNamespace:this.namespaceId,revision,previous,ordinal,change}));
 }
 async *since(projectId,expected,current,{signal}={}){
  if(!token(expected)||!token(current))throw new AppError('INVALID');let nextOrdinal=null;
  while(current!==expected){
   signal?.throwIfAborted();const value=current==='new'?null:await this.read(projectId,current);
   if(!value||value.change===null)throw new AppError('CONFLICT',[{domain:'ownershipRevision'}]);
   if(nextOrdinal!==null&&value.ordinal!==nextOrdinal)invalid();nextOrdinal=value.ordinal-1;yield value.change;current=value.previous;
  }
 }
}
