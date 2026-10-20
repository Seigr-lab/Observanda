// Publication consumes paged relocation proofs. Alias preparation and owner
// description retain one independently authorized project at a time.
import path from 'node:path';
import {LabBookDirectory} from './lab-book-directory.js';
import {withProjectMembership} from './project-membership.js';
import {ProjectReferenceAliases} from './project-reference-aliases.js';
import {projectPortableReferences} from './project-portable-references.js';
import {projectRegistryLocationKey} from './project-registry-locations.js';
import {withScratch} from './scratch-work.js';
import {relocationOwnerRoot} from './native-relocation-owners.js';
import {AppError} from './errors.js';
const same=(a,b)=>['projectId','namespaceId','vaultId','root','parentId'].every(key=>a?.[key]===b?.[key]);
export function nativeMovedProjectEntry(item,value,destination){return {projectId:item.projectId,namespaceId:item.namespaceId,vaultId:item.vaultId,parentId:item.relative?item.parentId:value.placement?.parentId??(value.placement?null:value.parentId),summary:item.summary,root:relocationOwnerRoot(destination,item)};}
export function nativeDepartureOwners(selected){const root=selected.command.scope(selected.value).source,owners=selected.owners,at=item=>item?{...item,root:relocationOwnerRoot(root,item)}:null;return {async get(relative){return at(await owners.get(relative));},async find(index,key){return at(await owners.find(index,key));},async *entries(options){for await(const item of owners.entries(options))yield at(item);}};}
export async function admitNativeWorkspaceTree(registry,selected,{fresh=false}={}){
 const value=selected.value,destination=selected.command.scope(value).destination,owners=selected.owners,addresses=new LabBookDirectory(registry);
 await registry.inspect(async view=>{for await(const item of owners.entries()){
  if(item.namespaceId===registry.workspaceId)throw new AppError('DATABASE_LOCATION');
  if(item.kind==='project'){
   const entry=nativeMovedProjectEntry(item,value,destination),prior=await view.get(entry.projectId);
   if(prior?.state==='relocated'&&['namespaceId','vaultId'].some(key=>prior.entry[key]!==entry[key])||prior?.state==='deleted')throw new AppError('DATABASE_LOCATION');
   if(prior?.state==='active'&&(fresh||!same(prior.entry,entry)))throw new AppError('PROJECT_LOCATION_EXISTS');
   for(const [index,key] of [['namespace',entry.namespaceId],['vault',entry.vaultId],['location',projectRegistryLocationKey(entry.root,registry.workspace.root)]]){const row=await view.get(key,{index});if(row&&row.entry.projectId!==entry.projectId)throw new AppError('DATABASE_LOCATION');}
   if(await addresses.read(entry.namespaceId))throw new AppError('DATABASE_LOCATION');
  }else{
   if(await view.get(item.namespaceId,{index:'namespace'})||await view.get(item.vaultId,{index:'vault'}))throw new AppError('DATABASE_LOCATION');const prior=await addresses.read(item.namespaceId);if(prior&&['projectId','labBookId','namespaceId','vaultId'].some(key=>prior[key]!==item[key]))throw new AppError('DATABASE_LOCATION');
  }
 }});
}
export async function publishNativeWorkspaceTree(registry,selected,{check=async()=>{},checkpoint=async()=>{}}={}){
 const value=selected.value,destination=selected.command.scope(value).destination,aliases=new ProjectReferenceAliases(registry.workspace);
 await withScratch(async staged=>{
  await admitNativeWorkspaceTree(registry,selected);
  for await(const item of selected.owners.entries({index:'project'}))await selected.use(destination,item,async storage=>{const expected=nativeMovedProjectEntry(item,value,destination),actual=await registry.describe(storage,expected.parentId);if(!same(actual,expected))throw new AppError('DATABASE_LOCATION');await staged.add(item.projectId,actual);});
  await withProjectMembership(registry,[value.placement.parentId],async()=>{for(let attempt=0;;attempt++){
   const current=await registry.inspect(view=>({revision:view.revision,aliases:view.aliases}));let references=current.aliases;
   for await(const item of selected.owners.entries({index:'project'}))await selected.use(destination,item,async storage=>{const bundle=await projectPortableReferences(storage,await staged.get(item.projectId));if(bundle)references=await aliases.prepare(references,bundle.owner,bundle.targets());});
   await check();await admitNativeWorkspaceTree(registry,selected);
   try{await registry.applyBatch(current.revision,(async function*(){for await(const entry of staged.items())yield {state:'active',entry};})(),{aliases:references});break;}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
  }},{wait:false});
 });
 await checkpoint('destination-registry',value);for await(const item of selected.owners.entries())if(item.kind==='lab-book')await new LabBookDirectory(registry).register(item.projectId,item);await checkpoint('destination-addresses',value);
}
export async function publishNativeProjectLocation(registry,selected){
 const value=selected.value,scope=selected.command.scope(value),name=path.basename(scope.destination);
 for(let attempt=0;;attempt++)try{
  await registry.inspect(async view=>{const changes=async function*(){for await(const item of selected.owners.entries({index:'project'})){
   const row=await view.get(item.projectId),entry=row?.state==='active'?row.entry:null;if(!entry||['namespaceId','vaultId'].some(key=>entry[key]!==item[key])||![relocationOwnerRoot(scope.source,item),relocationOwnerRoot(scope.destination,item)].includes(entry.root))throw new AppError('CONFLICT');
   const moved=nativeMovedProjectEntry(item,value,scope.destination);if(item.relative&&entry.parentId!==item.parentId||!item.relative&&![value.parentId,moved.parentId].includes(entry.parentId))throw new AppError('CONFLICT');moved.summary=entry.summary;if(!item.relative&&moved.summary)moved.summary={...moved.summary,title:name};yield {state:'active',entry:moved};
  }};await registry.applyBatch(view.revision,changes());});return;
 }catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
}
