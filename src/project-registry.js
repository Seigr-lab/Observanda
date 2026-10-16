import {assertProjectPresent,acceptRelocatedProject} from './project-relocation-directory.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {projectRenameLocation} from './project-rename-receipt.js';
import {encodeProjectRegistryLocations,decodeProjectRegistryLocations} from './project-registry-locations.js';
import {detachLegacyProjectChildren,legacyProjectChildren} from './project-retirement-children.js';
import {projectHierarchyLock} from './project-hierarchy-authority.js';
import {ProjectReferenceAliases} from './project-reference-aliases.js';
import {validTableRef} from './retained-table-index.js';
import {validProjectReferenceTarget} from './project-reference-target.js';
// Workspace membership and locations are small encrypted registry data, not
// project contents. This owner uses its own recoverable file lease; it never
// acquires a workspace catalogue writer or opens a sibling project database.
import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {assertRegular,privateDirectory,digest,serialize} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {catalogueBinding} from './postgres-activation.js';
import {readAccess} from './access.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const exact=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===names.sort().join();
const fields=['projectId','root','vaultId','namespaceId','parentId'];
const summaryOf=project=>({title:project.title,description:project.description??'',kind:project.kind??'Project',templateName:project.labBookTemplate?.name??null});
const validSummary=value=>value===null||exact(value,['title','description','kind','templateName'])&&(value.templateName===null||typeof value.templateName==='string'&&value.templateName.length<=160)&&['title','description','kind'].every(key=>typeof value[key]==='string'&&value[key].length<=({title:160,description:1500,kind:80})[key]);
export class ProjectRegistry{
 constructor(workspace,workspaceId){if(workspace.projectId||workspace.labBookId||!researchId(workspaceId))throw new AppError('INVALID');this.workspace=workspace;this.workspaceId=workspaceId;this.file=path.join(workspace.root,'.observanda','project-registry.observanda');}
 validate(value,{legacyProjects=null}={}){
  if(!exact(value,value?.version>=4?['version','workspaceId','projects','deleted','aliases',...(value.version>=7?['relocated']:[])]:value?.version===3?['version','workspaceId','projects','deleted']:['version','workspaceId','projects'])||![1,2,3,4,5,6,7].includes(value.version)||value.workspaceId!==this.workspaceId||!Array.isArray(value.projects))throw new AppError('FORMAT');
  if(value.version>=4&&!validTableRef(value.aliases))throw new AppError('FORMAT');
  const byId=new Map(),roots=new Set(),namespaces=new Set(),vaults=new Set();
  for(const entry of value.projects){
   if(!exact(entry,value.version===1?fields:[...fields,'summary'])||value.version>=2&&!validSummary(entry.summary)||!researchId(entry.projectId)||!researchId(entry.vaultId)||!researchId(entry.namespaceId)||entry.parentId!==null&&!researchId(entry.parentId)||typeof entry.root!=='string'||!path.isAbsolute(entry.root)||entry.root!==path.resolve(entry.root)||byId.has(entry.projectId)||roots.has(entry.root)||entry.namespaceId===this.workspaceId||namespaces.has(entry.namespaceId)||vaults.has(entry.vaultId))throw new AppError('FORMAT');
   byId.set(entry.projectId,entry);roots.add(entry.root);namespaces.add(entry.namespaceId);vaults.add(entry.vaultId);
  }
  if(value.version>=3){
   if(!Array.isArray(value.deleted))throw new AppError('FORMAT');
   for(const entry of value.deleted){
    if(!exact(entry,['projectId','namespaceId','vaultId','operationId'])||!Object.values(entry).every(researchId)||byId.has(entry.projectId)||namespaces.has(entry.namespaceId)||vaults.has(entry.vaultId)||entry.namespaceId===this.workspaceId)throw new AppError('FORMAT');
    byId.set(entry.projectId,null);namespaces.add(entry.namespaceId);vaults.add(entry.vaultId);
   }
  }
  if(value.version>=7){
   if(!Array.isArray(value.relocated))throw new AppError('FORMAT');
   for(const entry of value.relocated){
    if(!exact(entry,['projectId','namespaceId','vaultId','operationId','workspaceId'])||!Object.values(entry).every(researchId)||entry.workspaceId===this.workspaceId||byId.has(entry.projectId)||namespaces.has(entry.namespaceId)||vaults.has(entry.vaultId)||entry.namespaceId===this.workspaceId)throw new AppError('FORMAT');
    byId.set(entry.projectId,null);namespaces.add(entry.namespaceId);vaults.add(entry.vaultId);
   }
  }
  if(value.version>=5)for(const project of legacyProjects??[]){if(!byId.has(project.id))byId.set(project.id,{projectId:project.id,parentId:project.parentId??null});}
  const resolved=new Set();
  for(const entry of [...byId.values()].filter(Boolean)){const seen=new Set();let id=entry.projectId;while(id!==null&&!resolved.has(id)){if(value.version>=5&&legacyProjects===null&&!byId.has(id))break;if(seen.has(id)||!byId.get(id))throw new AppError('FORMAT');seen.add(id);id=byId.get(id).parentId;}for(const id of seen)resolved.add(id);}
  return value;
 }
 async read({metadata=null}={}){
  await this.workspace.requireStorageKey();await assertRegular(path.dirname(this.file),{directory:true});
  const stat=await assertRegular(this.file,{missing:true});if(!stat)return {value:{version:1,workspaceId:this.workspaceId,projects:[]},revision:'new'};
  if(stat.size>16*1024*1024)throw new AppError('LIMIT');const raw=await this.workspace.readFile(this.file,'utf8');let value;
  try{value=JSON.parse(raw);}catch{throw new AppError('FORMAT');}if(metadata&&metadata.id!==this.workspaceId)throw new AppError('WORKSPACE_CHANGED');return {value:this.validate(decodeProjectRegistryLocations(value,this.workspace.root),{legacyProjects:metadata?.projects??null}),revision:digest(raw)};
 }
 async change(expected,edit,{retiring=null}={}){
  if(typeof expected!=='string')throw new AppError('INVALID');
  const directory=await privateDirectory(this.workspace.root,'.observanda');
  return withWriterLease(path.join(directory,'project-registry.lock'),async()=>{
   const current=await this.read();if(current.revision!==expected)throw new AppError('CONFLICT');
   const editable=structuredClone(current.value);editable.version=7;editable.relocated??=[];editable.deleted??=[];editable.aliases??=null;for(const entry of editable.projects)entry.summary??=null;
   const next=this.validate(edit(editable)),raw=serialize(encodeProjectRegistryLocations(next,this.workspace.root));
   if(Buffer.byteLength(raw)>16*1024*1024-128)throw new AppError('LIMIT');
   const hierarchy=value=>serialize({projects:value.projects.map(({projectId,parentId})=>({projectId,parentId})),deleted:(value.deleted??[]).map(({projectId})=>projectId),relocated:(value.relocated??[]).map(({projectId})=>projectId)});
   // Locations, aliases and cached labels do not change ancestry. They must
   // remain available while the source catalogue is busy or unavailable.
   if(hierarchy(current.value)===hierarchy(next)){await this.workspace.writeFile(this.file,raw);return {value:next,revision:digest(raw)};}
   const db=await this.workspace.openCatalogue();
   try{
    await db.run('BEGIN');await projectHierarchyLock(db);
    const metadata=(await this.workspace.catalogueStore(db).snapshot()).metadata;
    if(metadata.id!==this.workspaceId)throw new AppError('WORKSPACE_CHANGED');
    if(retiring&&legacyProjectChildren(current.value,metadata,retiring).length)throw new AppError('CONFLICT');
    this.validate(next,{legacyProjects:metadata.projects});
    await this.workspace.writeFile(this.file,raw);await db.run('COMMIT');return {value:next,revision:digest(raw)};
   }finally{await db.close();}
  });
 }
 async hierarchy(value,metadata=null){metadata??=(await this.workspace.outline()).metadata;if(metadata.id!==this.workspaceId)throw new AppError('WORKSPACE_CHANGED');this.validate(value,{legacyProjects:metadata.projects});const owned=new Set([...value.projects,...(value.deleted??[]),...(value.relocated??[])].map(item=>item.projectId));return [...value.projects,...metadata.projects.filter(item=>!owned.has(item.id)).map(item=>({projectId:item.id,parentId:item.parentId??null,summary:summaryOf(item),legacy:true}))];}
 async directory(){
  for(let attempt=0;;attempt++){
   const current=await this.read(),projects=await this.hierarchy(current.value);
   if((await this.read()).revision!==current.revision){if(attempt>=7)throw new AppError('CONFLICT');continue;}
   return {...current,projects,revision:digest(serialize({registry:current.revision,legacy:projects.filter(item=>item.legacy)}))};
  }
 }
 async describe(storage,parentId,{staged=false}={}){
  if(!researchId(storage.projectId))throw new AppError('INVALID');
  const root=await realpath(storage.root),binding=await catalogueBinding(root),access=await readAccess(root);
  if(binding?.placement!=='project'||binding.projectId!==storage.projectId||access.value.vaultId!==storage.vault?.id)throw new AppError('DATABASE_LOCATION');
  const metadata=staged?await storage.catalogue(async store=>(await store.snapshot()).metadata):(await storage.outline()).metadata;
  return {projectId:storage.projectId,root,vaultId:storage.vault.id,namespaceId:metadata.id,parentId,summary:summaryOf(metadata.projects.find(project=>project.id===storage.projectId))};
 }
 async attach(storage,{parentId=null,expected}={}){
  const entry=await this.describe(storage,parentId);
  return this.change(expected,value=>{if(value.projects.some(p=>p.projectId===entry.projectId))throw new AppError('EXISTS');value.projects.push(entry);return value;});
 }
 async relocate(storage,{from,expected}={}){
  const entry=await this.describe(storage,null);
  return this.change(expected,value=>{const previous=value.projects.find(p=>p.projectId===entry.projectId);if(!previous||previous.root!==from||previous.namespaceId!==entry.namespaceId||previous.vaultId!==entry.vaultId)throw new AppError('CONFLICT');Object.assign(previous,{root:entry.root});return value;});
 }
 async reparent(projectId,parentId,{expected}={}){
  return this.change(expected,value=>{const entry=value.projects.find(p=>p.projectId===projectId);if(!entry)throw new AppError('NOT_FOUND');const parent=parentId===null?this.workspace.root:value.projects.find(item=>item.projectId===parentId)?.root;if(!parent||path.dirname(entry.root)!==parent)throw new AppError('STORAGE_PATH');entry.parentId=parentId;return value;});
 }
 // A display cache in the encrypted directory. Authoritative metadata and
 // history stay in their project; repairing one cache never opens siblings.
 async refreshSummary(projectId,metadata){
  const project=metadata.projects.find(item=>item.id===projectId);if(!project)throw new AppError('FORMAT');
  const summary=summaryOf(project);
  for(let attempt=0;;attempt++){
   const current=await this.read(),entry=current.value.projects.find(item=>item.projectId===projectId);
   if(!entry||entry.namespaceId!==metadata.id)throw new AppError('DATABASE_LOCATION');
   if(JSON.stringify(entry.summary)===JSON.stringify(summary))return;
   try{return await this.change(current.revision,value=>{value.projects.find(item=>item.projectId===projectId).summary=summary;return value;});}
   catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
  }
 }
 async retire(entry,operationId){
  if(!researchId(operationId))throw new AppError('INVALID');
  for(let attempt=0;;attempt++){
   const current=await this.read(),prior=current.value.projects.find(p=>p.projectId===entry.projectId),gone=current.value.deleted?.find(p=>p.projectId===entry.projectId);
   if(gone){if(gone.operationId!==operationId||gone.namespaceId!==entry.namespaceId||gone.vaultId!==entry.vaultId)throw new AppError('CONFLICT');return;}
   if(!prior||['root','vaultId','namespaceId'].some(key=>prior[key]!==entry[key]))throw new AppError('CONFLICT');
   try{
    await detachLegacyProjectChildren(this,entry);
    return await this.change(current.revision,value=>{
    value.projects=value.projects.filter(p=>p.projectId!==entry.projectId);
    for(const child of value.projects)if(child.parentId===entry.projectId)child.parentId=null;
    value.deleted.push({projectId:entry.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,operationId});return value;
   },{retiring:entry.projectId});}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
  }
 }
 registerExisting(expected,entry,{aliases}={}){return this.change(expected,value=>{
  acceptRelocatedProject(value,entry);const gone=value.deleted.find(p=>p.projectId===entry.projectId);if(gone&&(gone.namespaceId!==entry.namespaceId||gone.vaultId!==entry.vaultId))throw new AppError('DATABASE_LOCATION');
  value.deleted=value.deleted.filter(p=>p.projectId!==entry.projectId);value.projects.push(entry);if(aliases!==undefined)value.aliases=aliases;return value;
 });}
 async reference(target){
  if(!validProjectReferenceTarget(target))throw new AppError('INVALID');
  const {value}=await this.read();
  assertProjectPresent(value,{namespaceId:target.workspaceId});
  const direct=value.projects.find(p=>p.namespaceId===target.workspaceId);if(direct)return projectRenameLocation(this,direct,value.projects);
  const book=await new LabBookDirectory(this).locate(target.workspaceId);if(book)return book;
  const alias=await new ProjectReferenceAliases(this.workspace).locate(value.aliases??null,target);if(!alias)throw new AppError('NOT_FOUND');
  assertProjectPresent(value,{projectId:alias.projectId});
  const entry=value.projects.find(p=>p.projectId===alias.projectId);if(!entry||entry.namespaceId!==alias.namespaceId)throw new AppError('DATABASE_LOCATION');return projectRenameLocation(this,entry,value.projects);
 }
 async namespace(namespaceId){if(!researchId(namespaceId))throw new AppError('INVALID');const {value}=await this.read();assertProjectPresent(value,{namespaceId});const entry=value.projects.find(p=>p.namespaceId===namespaceId);if(!entry)throw new AppError('NOT_FOUND');return projectRenameLocation(this,entry,value.projects);}
 async locate(projectId){if(!researchId(projectId))throw new AppError('INVALID');const {value}=await this.read();assertProjectPresent(value,{projectId});const entry=value.projects.find(p=>p.projectId===projectId);if(!entry)throw new AppError('NOT_FOUND');return projectRenameLocation(this,entry,value.projects);}
}
