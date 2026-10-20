import {assertProjectRoot} from './project-root-boundaries.js';
import {OwnerDirectoryRegistry} from './owner-directory-registry.js';
import {resolveRecordOwnerReference} from './record-owner-provenance.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {projectRenameLocation} from './project-rename-receipt.js';
import {decodeProjectRegistryLocations,projectRegistryLocationKey} from './project-registry-locations.js';
import {detachLegacyProjectChildren,legacyProjectChildren} from './project-retirement-children.js';
import {projectHierarchyLock} from './project-hierarchy-authority.js';
import {ProjectReferenceAliases} from './project-reference-aliases.js';
import {validTableRef} from './retained-table-index.js';
import {validProjectReferenceTarget} from './project-reference-target.js';
// Workspace membership uses its own indexed encrypted directory and lease.
// Steady directory edits do not revise research or open sibling databases.
import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {digest,serialize} from './storage.js';
import {catalogueBinding} from './postgres-activation.js';
import {readAccess} from './access.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const exact=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===names.sort().join();
const fields=['projectId','root','vaultId','namespaceId','parentId'];
const summaryOf=project=>({title:project.title,description:project.description??'',kind:project.kind??'Project',templateName:project.labBookTemplate?.name??null});
const validSummary=value=>value===null||exact(value,['title','description','kind','templateName'])&&(value.templateName===null||typeof value.templateName==='string'&&value.templateName.length<=160)&&['title','description','kind'].every(key=>typeof value[key]==='string'&&value[key].length<=({title:160,description:1500,kind:80})[key]);
export class ProjectRegistry{
 constructor(workspace,workspaceId){if(workspace.projectId||workspace.labBookId||!researchId(workspaceId))throw new AppError('INVALID');this.workspace=workspace;this.workspaceId=workspaceId;this.file=path.join(workspace.root,'.observanda','project-registry.observanda');this.directoryOwner=new OwnerDirectoryRegistry({storage:workspace,kind:'projects',ownerId:workspaceId,file:this.file,decode:value=>this.validate(decodeProjectRegistryLocations(value,workspace.root)),empty:()=>({version:1,workspaceId,projects:[]}),validate:value=>this.validate(value)});}
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
 inspect(operation,options){return this.directoryOwner.inspect(operation,options);}
 version(){return this.directoryOwner.version();}
 state(id,options){if(!researchId(id)&&options?.index!=='location')throw new AppError('INVALID');return this.directoryOwner.state(id,options);}
 apply(expected,changes,options){return this.directoryOwner.apply(expected,changes,options);}
 applyBatch(expected,changes,options){return this.directoryOwner.applyBatch(expected,changes,options);}
 locationKey(root){return projectRegistryLocationKey(root,this.workspace.root);}
 async read({metadata=null}={}){const current=await this.directoryOwner.read();if(metadata){if(metadata.id!==this.workspaceId)throw new AppError('WORKSPACE_CHANGED');this.validate(current.value,{legacyProjects:metadata.projects});}return current;}
 change(expected,edit,{retiring=null,checkpoint}={}){
  return this.directoryOwner.change(expected,edit,{checkpoint,validate:async(before,after,store)=>{
   await projectHierarchyLock(store.db);const metadata=(await store.snapshot()).metadata;if(metadata.id!==this.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(retiring&&legacyProjectChildren(before,metadata,retiring).length)throw new AppError('CONFLICT');this.validate(after,{legacyProjects:metadata.projects});
  }});
 }
 async hierarchy(value,metadata=null){metadata??=(await this.workspace.outline()).metadata;if(metadata.id!==this.workspaceId)throw new AppError('WORKSPACE_CHANGED');this.validate(value,{legacyProjects:metadata.projects});const owned=new Set([...value.projects,...(value.deleted??[]),...(value.relocated??[])].map(item=>item.projectId));return [...value.projects,...metadata.projects.filter(item=>!owned.has(item.id)).map(item=>({projectId:item.id,parentId:item.parentId??null,summary:summaryOf(item),legacy:true}))];}
 async directory(){
  for(let attempt=0;;attempt++){
   const current=await this.read(),projects=await this.hierarchy(current.value);
   if((await this.read()).revision!==current.revision){if(attempt>=7)throw new AppError('CONFLICT');continue;}
   return {...current,projects,revision:digest(serialize({registry:current.revision,legacy:projects.filter(item=>item.legacy)}))};
  }
 }
 async assertRoot(root,{existing=false,parentId,excludeRoots=[]}={}){
  if(!Array.isArray(excludeRoots)||excludeRoots.some(value=>typeof value!=='string'||path.resolve(value)!==value||!insideProjectRoot(root,value)))throw new AppError('STORAGE_PATH');
  return this.inspect(async view=>{
   const locationKey=value=>this.locationKey(value);
   const entries=new Map(),selected=await view.get(locationKey(root),{index:'location'});if(selected)entries.set(selected.entry.projectId,selected.entry);
   const chosen=parentId===undefined?selected?.entry.parentId??null:parentId;if(chosen!==null)for(const entry of await view.ancestors(chosen))entries.set(entry.projectId,entry);
   for(let current=path.dirname(root);current!==path.dirname(current);current=path.dirname(current)){const row=await view.get(locationKey(current),{index:'location'});if(row)entries.set(row.entry.projectId,row.entry);}
   const key=locationKey(root);for await(const row of view.entries({index:'location',prefix:key+(key.startsWith('relative:')?'/':path.sep)})){if(excludeRoots.some(excluded=>row.entry.root===excluded||insideProjectRoot(excluded,row.entry.root)))continue;entries.set(row.entry.projectId,row.entry);break;}
   assertProjectRoot(this.workspace.root,root,[...entries.values()],{existing,parentId});
  });
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
  return this.apply(expected,[{state:'active',entry}],{check:async(directory,head)=>{if(await directory.find(head,entry.projectId))throw new AppError('EXISTS');}});
 }
 async relocate(storage,{from,expected}={}){
  const entry=await this.describe(storage,null),prior=await this.state(entry.projectId);
  if(prior.revision!==expected||prior.state!=='active'||prior.entry.root!==from||prior.entry.namespaceId!==entry.namespaceId||prior.entry.vaultId!==entry.vaultId)throw new AppError('CONFLICT');
  return this.apply(expected,[{state:'active',entry:{...prior.entry,root:entry.root}}]);
 }
 async reparent(projectId,parentId,{expected}={}){
  const current=await this.state(projectId);if(current.revision!==expected)throw new AppError('CONFLICT');if(current.state!=='active')throw new AppError('NOT_FOUND');
  const parent=parentId===null?this.workspace.root:(await this.state(parentId)).entry?.root;if(!parent||path.dirname(current.entry.root)!==parent)throw new AppError('STORAGE_PATH');
  return this.apply(expected,[{state:'active',entry:{...current.entry,parentId}}]);
 }
 async refreshSummary(projectId,metadata){
  const project=metadata.projects.find(item=>item.id===projectId);if(!project)throw new AppError('FORMAT');const summary=summaryOf(project);
  for(let attempt=0;;attempt++){
   const current=await this.state(projectId);if(current.state!=='active'||current.entry.namespaceId!==metadata.id)throw new AppError('DATABASE_LOCATION');if(JSON.stringify(current.entry.summary)===JSON.stringify(summary))return;
   try{return await this.apply(current.revision,[{state:'active',entry:{...current.entry,summary}}]);}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
  }
 }
 async retire(entry,operationId){
  if(!researchId(operationId))throw new AppError('INVALID');
  for(let attempt=0;;attempt++){
   const current=await this.state(entry.projectId);if(current.state==='deleted'){if(current.entry.operationId!==operationId||current.entry.namespaceId!==entry.namespaceId||current.entry.vaultId!==entry.vaultId)throw new AppError('CONFLICT');return;}
   if(current.state!=='active'||['root','vaultId','namespaceId'].some(key=>current.entry[key]!==entry[key]))throw new AppError('CONFLICT');
   try{await detachLegacyProjectChildren(this,entry);return await this.inspect(async view=>{
    if(view.revision!==current.revision)throw new AppError('CONFLICT');const changes=async function*(){for await(const child of view.entries({index:'parent',prefix:entry.projectId+':'}))yield {state:'active',entry:{...child.entry,parentId:null}};yield {state:'deleted',entry:{projectId:entry.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,operationId}};};
    return this.applyBatch(current.revision,changes(),{check:async(directory,head,store)=>{const metadata=(await store.snapshot()).metadata;for(const child of metadata.projects)if(child.parentId===entry.projectId&&!await directory.find(head,child.id))throw new AppError('CONFLICT');}});
   });}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
  }
 }
 registerExisting(expected,entry,{aliases}={}){return this.apply(expected,[{state:'active',entry}],{aliases,check:async(directory,head)=>{
  const prior=await directory.find(head,entry.projectId);if(prior?.state==='active')throw new AppError('EXISTS');if(prior&&['namespaceId','vaultId'].some(key=>prior.entry[key]!==entry[key]))throw new AppError('DATABASE_LOCATION');
 }});}
 async reference(target){
  if(!validProjectReferenceTarget(target))throw new AppError('INVALID');const moved=await resolveRecordOwnerReference(this,target);if(moved)return moved;
  return this.inspect(async view=>{
   const direct=await view.get(target.workspaceId,{index:'namespace'});this.assertState(direct);
   if(direct)return projectRenameLocation(this,direct.entry,await view.ancestors(direct.entry.projectId));
   const book=await new LabBookDirectory(this).locate(target.workspaceId);if(book)return book;
   const alias=await new ProjectReferenceAliases(this.workspace).locate(view.aliases,target);if(!alias)throw new AppError('NOT_FOUND');
   const row=await view.get(alias.projectId);this.assertState(row);if(!row||row.entry.namespaceId!==alias.namespaceId)throw new AppError('DATABASE_LOCATION');return projectRenameLocation(this,row.entry,await view.ancestors(row.entry.projectId));
  });
 }
 assertState(row){if(!row)return;if(row.state==='deleted')throw new AppError('PROJECT_DELETED');if(row.state==='relocated'){const error=new AppError('PROJECT_MOVED');error.projectId=row.entry.projectId;error.workspaceId=row.entry.workspaceId;throw error;}}
 namespace(namespaceId){if(!researchId(namespaceId))throw new AppError('INVALID');return this.inspect(async view=>{const row=await view.get(namespaceId,{index:'namespace'});this.assertState(row);if(!row)throw new AppError('NOT_FOUND');return projectRenameLocation(this,row.entry,await view.ancestors(row.entry.projectId));});}
 locate(projectId){if(!researchId(projectId))throw new AppError('INVALID');return this.inspect(async view=>{const row=await view.get(projectId);this.assertState(row);if(!row)throw new AppError('NOT_FOUND');return projectRenameLocation(this,row.entry,await view.ancestors(projectId));});}
}

function insideProjectRoot(root,child){const relative=path.relative(root,child);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
