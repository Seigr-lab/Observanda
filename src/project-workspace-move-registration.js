// Destination publication is a short membership change after each independent
// owner is verified. It can repeat after an interrupted acknowledgement.
import path from 'node:path';
import {LabBookDirectory} from './lab-book-directory.js';
import {withProjectMembership} from './project-membership.js';
import {ProjectReferenceAliases} from './project-reference-aliases.js';
import {projectPortableReferences} from './project-portable-references.js';
import {acceptRelocatedProject} from './project-relocation-directory.js';
import {AppError} from './errors.js';
const same=(a,b)=>['projectId','namespaceId','vaultId','root','parentId'].every(key=>a?.[key]===b?.[key]);
export function movedProjectEntries(value,destination){return value.entries.map((entry,index)=>{const {relative,...selected}=entry;return {...selected,root:path.join(destination,...relative.split('/')),parentId:index?entry.parentId:value.placement.parentId};});}
export function movedBookEntries(value){return [{projectId:value.projectId,books:value.rootBooks.books??[]},...(value.projects??[])].flatMap(project=>(project.books??[]).map(book=>({...book,projectId:project.projectId})));}
export async function admitWorkspaceProjectTree(registry,value,destination,{fresh=false}={}){
 const current=(await registry.read()).value,entries=movedProjectEntries(value,destination),books=movedBookEntries(value),addresses=new LabBookDirectory(registry);
 const namespaces=new Set([registry.workspaceId]),vaults=new Set();
 for(const owner of [...entries,...books]){if(namespaces.has(owner.namespaceId)||vaults.has(owner.vaultId))throw new AppError('DATABASE_LOCATION');namespaces.add(owner.namespaceId);vaults.add(owner.vaultId);}
 for(const entry of entries){
  acceptRelocatedProject(structuredClone(current),entry);const prior=current.projects.find(project=>project.projectId===entry.projectId);
  if(prior&&(fresh||!same(prior,entry)))throw new AppError('PROJECT_LOCATION_EXISTS');
  if(current.projects.some(project=>project.projectId!==entry.projectId&&(project.root===entry.root||project.namespaceId===entry.namespaceId||project.vaultId===entry.vaultId))||(current.deleted??[]).some(project=>project.projectId===entry.projectId||project.namespaceId===entry.namespaceId||project.vaultId===entry.vaultId)||await addresses.read(entry.namespaceId))throw new AppError('DATABASE_LOCATION');
 }
 for(const book of books){
  if(book.namespaceId===registry.workspaceId||[...current.projects,...(current.deleted??[]),...(current.relocated??[]),...entries].some(project=>project.namespaceId===book.namespaceId||project.vaultId===book.vaultId))throw new AppError('DATABASE_LOCATION');
  const prior=await addresses.read(book.namespaceId);if(prior&&['projectId','labBookId','namespaceId','vaultId'].some(key=>prior[key]!==book[key]))throw new AppError('DATABASE_LOCATION');
 }
 return entries;
}
export async function publishWorkspaceProjectTree(registry,value,transfer,{check=async()=>{},checkpoint=async()=>{}}={}){
 const destination=transfer.command.scope(value).destination;
 return transfer.using(destination,async owners=>{
  const entries=await admitWorkspaceProjectTree(registry,value,destination),portable=[],aliases=new ProjectReferenceAliases(registry.workspace);
  for(const entry of entries){const owner=owners.find(owner=>owner.kind==='project'&&owner.ownerId===entry.projectId),actual=await registry.describe(owner.storage,entry.parentId);if(!same(actual,entry))throw new AppError('DATABASE_LOCATION');entry.summary=actual.summary;portable.push(await projectPortableReferences(owner.storage,actual));}
  await withProjectMembership(registry,[value.placement.parentId],async()=>{
   for(let attempt=0;;attempt++){
    const current=await registry.read();let references=current.value.aliases??null;for(const bundle of portable)if(bundle)references=await aliases.prepare(references,bundle.owner,bundle.targets());
    await check();await admitWorkspaceProjectTree(registry,value,destination);
    try{await registry.change(current.revision,data=>{for(const entry of entries){const prior=data.projects.find(project=>project.projectId===entry.projectId);if(prior){if(!same(prior,entry))throw new AppError('CONFLICT');}else{acceptRelocatedProject(data,entry);data.projects.push(entry);}}data.aliases=references;return data;});break;}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
   }
  },{wait:false});
  await checkpoint('destination-registry',value);for(const book of movedBookEntries(value))await new LabBookDirectory(registry).register(book.projectId,book);await checkpoint('destination-addresses',value);
 });
}
