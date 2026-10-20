// Destination publication is a short membership change after each independent
// owner is verified. It can repeat after an interrupted acknowledgement.
import path from 'node:path';
import {LabBookDirectory} from './lab-book-directory.js';
import {withProjectMembership} from './project-membership.js';
import {ProjectReferenceAliases} from './project-reference-aliases.js';
import {projectPortableReferences} from './project-portable-references.js';
import {projectRegistryLocationKey} from './project-registry-locations.js';
import {AppError} from './errors.js';
const same=(a,b)=>['projectId','namespaceId','vaultId','root','parentId'].every(key=>a?.[key]===b?.[key]);
export function movedProjectEntries(value,destination){return value.entries.map((entry,index)=>{const {relative,...selected}=entry;return {...selected,root:path.join(destination,...relative.split('/')),parentId:index?entry.parentId:value.placement.parentId};});}
export function movedBookEntries(value){return [{projectId:value.projectId,books:value.rootBooks.books??[]},...(value.projects??[])].flatMap(project=>(project.books??[]).map(book=>({...book,projectId:project.projectId})));}
export async function admitWorkspaceProjectTree(registry,value,destination,{fresh=false}={}){
 const entries=movedProjectEntries(value,destination),books=movedBookEntries(value),addresses=new LabBookDirectory(registry);
 const namespaces=new Set([registry.workspaceId]),vaults=new Set();
 for(const owner of [...entries,...books]){if(namespaces.has(owner.namespaceId)||vaults.has(owner.vaultId))throw new AppError('DATABASE_LOCATION');namespaces.add(owner.namespaceId);vaults.add(owner.vaultId);}
 await registry.inspect(async view=>{
  for(const entry of entries){
   const prior=await view.get(entry.projectId);
   if(prior?.state==='relocated'&&['namespaceId','vaultId'].some(key=>prior.entry[key]!==entry[key]))throw new AppError('DATABASE_LOCATION');
   if(prior?.state==='deleted')throw new AppError('DATABASE_LOCATION');
   if(prior?.state==='active'&&(fresh||!same(prior.entry,entry)))throw new AppError('PROJECT_LOCATION_EXISTS');
   for(const [index,key] of [['namespace',entry.namespaceId],['vault',entry.vaultId],['location',projectRegistryLocationKey(entry.root,registry.workspace.root)]]){
    const row=await view.get(key,{index});if(row&&row.entry.projectId!==entry.projectId)throw new AppError('DATABASE_LOCATION');
   }
   if(await addresses.read(entry.namespaceId))throw new AppError('DATABASE_LOCATION');
  }
  for(const book of books){
   if(await view.get(book.namespaceId,{index:'namespace'})||await view.get(book.vaultId,{index:'vault'}))throw new AppError('DATABASE_LOCATION');
   const prior=await addresses.read(book.namespaceId);if(prior&&['projectId','labBookId','namespaceId','vaultId'].some(key=>prior[key]!==book[key]))throw new AppError('DATABASE_LOCATION');
  }
 });
 return entries;
}
export async function publishWorkspaceProjectTree(registry,value,transfer,{check=async()=>{},checkpoint=async()=>{}}={}){
 const destination=transfer.command.scope(value).destination;
 return transfer.using(destination,async owners=>{
  const entries=await admitWorkspaceProjectTree(registry,value,destination),portable=[],aliases=new ProjectReferenceAliases(registry.workspace);
  for(const entry of entries){const owner=owners.find(owner=>owner.kind==='project'&&owner.ownerId===entry.projectId),actual=await registry.describe(owner.storage,entry.parentId);if(!same(actual,entry))throw new AppError('DATABASE_LOCATION');entry.summary=actual.summary;portable.push(await projectPortableReferences(owner.storage,actual));}
  await withProjectMembership(registry,[value.placement.parentId],async()=>{
   for(let attempt=0;;attempt++){
    const current=await registry.inspect(view=>({revision:view.revision,aliases:view.aliases}));let references=current.aliases;for(const bundle of portable)if(bundle)references=await aliases.prepare(references,bundle.owner,bundle.targets());
    await check();await admitWorkspaceProjectTree(registry,value,destination);
    try{await registry.apply(current.revision,entries.map(entry=>({state:'active',entry})),{aliases:references});break;}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
   }
  },{wait:false});
  await checkpoint('destination-registry',value);for(const book of movedBookEntries(value))await new LabBookDirectory(registry).register(book.projectId,book);await checkpoint('destination-addresses',value);
 });
}
