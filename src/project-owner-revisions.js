// Each project's ownership choices have an independent change token and OS
// lease. Advance the token before changing a choice: an interrupted assignment
// can invalidate staging, but can never conceal a changed owner.
import {ProjectOwnerHistory} from './project-owner-history.js';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withWriterLease,writerLeaseHeld} from './writer-lease.js';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const base='.observanda/project-owner-revisions';
export class ProjectOwnerRevisions{
 constructor(workspace,namespaceId){if(workspace.projectId||!researchId(namespaceId))throw new AppError('INVALID');this.workspace=workspace;this.namespaceId=namespaceId;}
 file(id){if(!researchId(id))throw new AppError('INVALID');return path.join(this.workspace.root,base,id+'.obsv');}
 async read(id){
  const file=this.file(id);await this.workspace.requireStorageKey();
  for(const part of ['.observanda',base])if(!await assertRegular(path.join(this.workspace.root,part),{directory:true,missing:true}))return 'new';
  const stat=await assertRegular(file,{missing:true});if(!stat)return 'new';if(stat.size>1024)throw new AppError('FORMAT');let value;try{value=JSON.parse(await this.workspace.readFile(file,'utf8'));}catch{throw new AppError('FORMAT');}
  if(Object.keys(value??{}).sort().join()!=='projectId,revision,sourceNamespace,version'||value.version!==1||value.projectId!==id||value.sourceNamespace!==this.namespaceId||!researchId(value.revision))throw new AppError('FORMAT');return value.revision;
 }
 async withProjects(ids,operation){
  if(!Array.isArray(ids)||ids.some(id=>!researchId(id)))throw new AppError('INVALID');const ordered=[...new Set(ids)].sort();await this.workspace.requireStorageKey();await privateDirectory(this.workspace.root,base);
  const enter=index=>index===ordered.length?operation():withWriterLease(this.file(ordered[index])+'.lock',()=>enter(index+1));return enter(0);
 }
 async advanceLocked(id,change=null){if(!writerLeaseHeld(this.file(id)+'.lock'))throw new AppError('INVALID');const previous=await this.read(id),revision=randomUUID();await new ProjectOwnerHistory(this.workspace,this.namespaceId).append(id,previous,revision,change);await this.workspace.writeFile(this.file(id),serialize({version:1,projectId:id,sourceNamespace:this.namespaceId,revision}));return revision;}
 async revision(id){return writerLeaseHeld(this.file(id)+'.lock')?this.read(id):this.withProjects([id],()=>this.read(id));}
 async checked(id,expected,operation){return this.withProjects([id],async()=>{if(await this.read(id)!==expected)throw new AppError('CONFLICT');return operation();});}
}
