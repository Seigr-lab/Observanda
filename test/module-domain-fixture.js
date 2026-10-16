import {ModuleDraftTransfer} from '../src/modules/draft-transfer.js';
import {ProjectDomains} from '../src/project-domains.js';
import {projectModuleDraftContext} from '../src/project-module-draft-context.js';
import {moduleDraftDomain} from '../src/modules/draft-domains.js';
export function moduleDomainStore(workspace,namespaceId,domain,operation,{write=false}={}){
 return new ProjectDomains(workspace,namespaceId).run([domain],get=>operation(get(domain)),{write:write?[domain]:[]});
}
export function moduleDraftStore(workspace,namespaceId,moduleId,operation,{write=false}={}){
 return new ProjectDomains(workspace,namespaceId).run([moduleDraftDomain(moduleId)],async(_get,context)=>operation(await projectModuleDraftContext(context,moduleId,{writable:write})),{authoring:write?[moduleId]:[]});
}
export function moduleDraftOwners(workspace,namespaceId,moduleId){
 const run=(operation,write=false)=>moduleDraftStore(workspace,namespaceId,moduleId,operation,{write});
 const drafts={read:(...args)=>run(c=>c.drafts.read(...args)),list:(...args)=>run(c=>c.drafts.list(...args)),write:(...args)=>run(c=>c.drafts.write(...args),true)};
 const transfer=Object.fromEntries(['start','part','finish','manifest'].map(method=>[method,(...args)=>run(c=>new ModuleDraftTransfer(c.workspace)[method](...args),method!=='manifest')]));
 return {drafts,transfer,run};
}
