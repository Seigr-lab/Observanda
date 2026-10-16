import {readProjectDomainRegistry} from '../src/project-domain-registry.js';
import {ProjectDomains} from '../src/project-domains.js';
import {ProjectModuleIdentities,moduleEventHash} from '../src/project-module-identities.js';
import {moduleDomain} from '../src/modules/domains.js';
import {randomUUID} from 'node:crypto';
import {workspaceModules} from '../src/modules/index.js';
import {serialize} from '../src/storage-format.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
export async function legacyModuleHead(store,workspaceId){
 const catalogue=new ModuleCatalogue(store),head=await catalogue.head(workspaceId),entities=[];
 for await(const member of catalogue.members(head))entities.push(member);
 const {memberVersion,root,...legacy}=head;void memberVersion;void root;
 await store.db.run("DELETE FROM state WHERE starts_with(slot,'module-member:') OR starts_with(slot,'module-member-index:')");
 return {...legacy,entities};
}
// Seed a declared current-state workload in one ordinary catalogue transaction.
// This helper is test-only; application creation still uses domain commands.
export async function seedModuleCurrent(workspace,workspaceId,entities){
 const modules=workspaceModules(workspace),data={formatVersion:1,workspaceId,revision:1,entities};
 const event={id:randomUUID(),commandId:randomUUID(),fingerprint:'0'.repeat(64),action:'qualification.seed',at:entities[0]?.updatedAt??new Date().toISOString(),changes:entities};
 modules.validate(data,{history:false});modules.validateEvent(event);
 if(Buffer.byteLength(serialize(data))>64*1024*1024||Buffer.byteLength(serialize(event))>64*1024*1024)throw Error('Fixture exceeds the accepted module capacity');
 if((await workspace.catalogue(readProjectDomainRegistry))?.commandVersion===1){
  const domains=[...new Set(entities.map(e=>moduleDomain(e.type)))].sort();
  await new ProjectDomains(workspace,workspaceId).run(domains,async(get,{research,registry,inspect})=>{
   const identities=new ProjectModuleIdentities(research,registry,inspect),fragments=[],pending=[];
   for(const domain of domains){
    const catalogue=new ModuleCatalogue(get(domain)),head=await catalogue.head(workspaceId);if(head.revision!==0)throw Error('Seed requires an empty module domain');
    const selected=entities.filter(e=>moduleDomain(e.type)===domain),fragment={...event,changes:selected};
    for(const entity of selected)await identities.claim('entity',entity.id,{domain});
    fragments.push({domain,ordinal:1,hash:moduleEventHash(fragment)});pending.push({catalogue,head,selected,fragment});
   }
   await identities.claim('command',event.commandId,{primary:domains[0],fingerprint:event.fingerprint,originHash:null,action:event.action,eventId:event.id,at:event.at,read:[],write:domains,fragments});
   for(const {catalogue,head,selected,fragment} of pending)await catalogue.writeChanges(head,selected,fragment);
  },{write:domains});
 }else await workspace.withLock(()=>workspace.catalogue(store=>store.putModuleData(data,new Set(entities.map(e=>e.id)),event)));
 return data;
}
