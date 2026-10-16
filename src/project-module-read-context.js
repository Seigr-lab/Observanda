import {projectModuleFederation} from './project-module-federation.js';
import {moduleDomain} from './modules/domains.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
// One read snapshot supplies every query step, including supporting facts.
export async function projectModuleReadContext(storage,namespaceId,identities,domains,{scoped=false}={}){
 const federation=await projectModuleFederation(identities,[...new Set(domains)].sort()),research=identities.research;
 const book=(await research.snapshot()).metadata,revisions=Object.fromEntries([...federation.owners].map(([domain,o])=>[domain,o.head.revision]));
 const scope=scoped?{projects:book.projects,notebooks:book.notebooks}:null,revision=digest(serialize({revisions,scope}));
 const context={book,head:{revision},revisions,
  members:options=>federation.members(federation.head,options),member:id=>federation.member(federation.head,id),selected:id=>federation.selected(federation.head,id),
  encode:value=>research.encode('project-module-page',storage.projectId+'/'+namespaceId,value).toString('base64url'),decode:value=>research.decode('project-module-page',storage.projectId+'/'+namespaceId,Buffer.from(value,'base64url'))};
 for(const method of ['view','search','references','constraint','calendar','inventory'])context[method]=member=>{
  const owner=federation.owners.get(moduleDomain(member.type));if(!owner)throw new AppError('CATALOGUE_DAMAGED');return owner.catalogue[method](owner.head,member);
 };
 return context;
}
export const operationalReadDomains={inventory:['bom','inventory'],planning:['calendars','equipment','inventory','tasks']};
export function planningReadDomains(type){
 if(!['task','booking','calendar','event'].includes(type))throw new AppError('INVALID');
 return type==='booking'?['equipment','inventory']:[moduleDomain(type)];
}
