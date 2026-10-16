// Legacy ownership choices are independent encrypted files. They do not take
// a catalogue writer, and bind a choice to an item's immutable identity.
import path from 'node:path';
import {assertRegular,digest,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const base='.observanda/project-owner-declarations';
const domains=new Set(['media','mediaImport','starter','starterUpload','module','font','review']);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const ownerValid=v=>v?.kind==='workspace'?exact(v,['kind']):v?.kind==='project'&&exact(v,['kind','projectId'])&&researchId(v.projectId);
const issue=()=>{throw new AppError('PROJECT_MIGRATION_OWNERSHIP');};
export class ProjectOwnerDeclarations{
 constructor(workspace,namespaceId){if(workspace.projectId||!researchId(namespaceId))throw new AppError('INVALID');this.workspace=workspace;this.namespaceId=namespaceId;}
 file(domain,id){if(!domains.has(domain)||!(domain==='font'?typeof id==='string'&&/^custom-[a-f0-9]{64}$/.test(id):researchId(id)))throw new AppError('INVALID');return path.join(this.workspace.root,base,domain,id+'.obsv');}
 validate(value,domain,id){
  if(!exact(value,['version','sourceNamespace','domain','id','identity','owner'])||value.version!==1||value.sourceNamespace!==this.namespaceId||value.domain!==domain||value.id!==id||!revisionId(value.identity)||!ownerValid(value.owner))issue();return value;
 }
 async read(domain,id){
  const file=this.file(domain,id);await this.workspace.requireStorageKey();
  for(const part of ['.observanda',base,base+'/'+domain])if(!await assertRegular(path.join(this.workspace.root,part),{missing:true,directory:true}))return {value:null,revision:'new'};
  const stat=await assertRegular(file,{missing:true});if(!stat)return {value:null,revision:'new'};if(stat.size>8192)issue();const raw=await this.workspace.readFile(file,'utf8');let value;try{value=JSON.parse(raw);}catch{issue();}return {value:this.validate(value,domain,id),revision:digest(raw)};
 }
 checkDescriptor(descriptor){if(!descriptor||!revisionId(descriptor.identity)||!revisionId(descriptor.revision))issue();}
 compatible(owner,descriptor){
  if(descriptor.fact&&descriptor.fact.kind!=='undeclared'&&serialize(owner)!==serialize(descriptor.fact))issue();
 }
 resolveDecision(domain,id,descriptor,decision){
  this.file(domain,id);this.checkDescriptor(descriptor);const {value}=decision;if(!value)return null;this.validate(value,domain,id);
  if(value.identity!==descriptor.identity)issue();this.compatible(value.owner,descriptor);
  return {id,sourceNamespace:this.namespaceId,revision:descriptor.revision,...value.owner};
 }
 async resolve(domain,id,descriptor){return this.resolveDecision(domain,id,descriptor,await this.read(domain,id));}
}
