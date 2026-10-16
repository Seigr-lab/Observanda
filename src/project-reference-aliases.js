// Compatibility locations are a dedicated encrypted index. Its small root is
// adopted with registry membership; preparing immutable pages exposes nothing.
// Resolving one old reference never scans project databases or source history.
import path from 'node:path';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {assertRegular,privateDirectory,digest,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
import {projectReferenceKinds as kinds,validProjectReferenceTarget} from './project-reference-target.js';
const base='.observanda/project-reference-aliases';
const exact=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===fields.slice().sort().join();
const validOwner=v=>exact(v,['version','sourceNamespace','namespaceId','projectId'])&&v.version===1&&[v.sourceNamespace,v.namespaceId,v.projectId].every(researchId)&&v.sourceNamespace!==v.namespaceId;
const hash=v=>digest(serialize(v));
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export class ProjectReferenceAliases{
 constructor(workspace){this.workspace=workspace;}
 file(kind,id){if(!['nodes','owners'].includes(kind)||!revisionId(id))throw new AppError('INVALID');return path.join(this.workspace.root,base,kind,id+'.obsv');}
 async read(kind,id){
  const file=this.file(kind,id);await assertRegular(path.join(this.workspace.root,'.observanda'),{directory:true});await assertRegular(path.join(this.workspace.root,base),{directory:true});await assertRegular(path.dirname(file),{directory:true});
  const stat=await assertRegular(file);if(stat.size>32768)damaged();let value;
  try{value=JSON.parse(await this.workspace.readFile(file,'utf8'));}catch(error){if(error instanceof SyntaxError)damaged();throw error;}
  if(hash(value)!==id)damaged();return value;
 }
 async put(kind,value){
  const id=hash(value),file=this.file(kind,id);await privateDirectory(this.workspace.root,base+'/'+kind);
  if(await assertRegular(file,{missing:true})){if(hash(await this.read(kind,id))!==id)damaged();}
  else await this.workspace.writeFile(file,serialize(value));return id;
 }
 async locate(root,target){
  if(!validTableRef(root)||!validProjectReferenceTarget(target)||!kinds.includes(target.kind))throw new AppError('INVALID');
  const index=new RetainedTableIndex(this,{namespace:'nodes',allowSparseBranches:true}),key=target.workspaceId+'/'+target.kind+'/'+target.id,entry=await index.find({root},key);
  if(!entry)return null;const owner=await this.read('owners',entry.revision);
  if(!validOwner(owner)||owner.sourceNamespace!==target.workspaceId||target.kind==='project'&&owner.projectId!==target.id)damaged();return owner;
 }
 async *targets(root,owner,{signal}={}){
  if(!validTableRef(root)||!validOwner(owner))throw new AppError('INVALID');
  const index=new RetainedTableIndex(this,{namespace:'nodes',allowSparseBranches:true}),revision=hash(owner);
  for await(const row of index.entries({root})){
   signal?.throwIfAborted();const [namespace,kind,id,...extra]=row.id.split('/');
   if(extra.length||namespace!==owner.sourceNamespace||row.revision!==revision||!kinds.includes(kind)||!researchId(id)||kind==='project'&&id!==owner.projectId)damaged();yield {kind,id};
  }
 }
 async prepare(root,owner,targets,{signal}={}){
  if(!validTableRef(root)||!validOwner(owner)||!targets)throw new AppError('INVALID');signal?.throwIfAborted();
  const index=new RetainedTableIndex(this,{namespace:'nodes',allowSparseBranches:true}),revision=await this.put('owners',owner),batch=new Map();
  const flush=async()=>{if(!batch.size)return;const changes=[...batch].map(([id,revision])=>({id,revision})).sort((a,b)=>a.id<b.id?-1:1);root=await index.changeMany(root,changes,{signal});await index.flush(root);batch.clear();};
  for await(const target of targets){
   signal?.throwIfAborted();if(!exact(target,['kind','id'])||!kinds.includes(target.kind)||!researchId(target.id)||target.kind==='project'&&target.id!==owner.projectId)throw new AppError('INVALID');
   const key=owner.sourceNamespace+'/'+target.kind+'/'+target.id,prior=await index.find({root},key);
   if(prior&&prior.revision!==revision)throw new AppError('PROJECT_MIGRATION_OWNERSHIP',[target]);
   if(!prior)batch.set(key,revision);if(batch.size===32)await flush();
  }
  await flush();return root;
 }
}
