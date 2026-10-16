import {catalogueIndexedCount} from './postgres-indexes.js';
// Bidirectional audit: every retained original/receipt has a route, and no
// directory row survives without its authoritative domain member/receipt.
import {projectModuleOriginEvent} from './project-module-domain-receipts.js';
import {ProjectModuleIdentities,moduleIdentityPrefix} from './project-module-identities.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {withScratch} from './scratch-work.js';
import {AppError} from './errors.js';
export async function verifyProjectModuleIdentities(research,registry,inspect){
 if(registry?.commandVersion!==1)return;
 const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');},identities=new ProjectModuleIdentities(research,registry,inspect);
 if((await new ModuleCatalogue(research).head(registry.namespaceId)).revision)damaged();
 await withScratch(async work=>{
  let count=0;
  for(const domain of registry.domains){const {catalogue,head}=await identities.owner(domain);
   for await(const member of catalogue.members(head)){const route=await identities.read('entity',member.id);if(route?.domain!==domain)damaged();count++;}
   for await(const row of catalogue.store.db.rows('SELECT command_id,ordinal,payload FROM module_events ORDER BY ordinal',[],{batchSize:1})){
    const receipt=await identities.read('command',row.command_id);if(!receipt?.fragments.some(f=>f.domain===domain&&f.ordinal===row.ordinal))damaged();
    if(await work.add(row.command_id)){const fragments=await identities.fragments(receipt);await projectModuleOriginEvent(research,receipt,fragments);count++;}
   }
  }
  const actual=await catalogueIndexedCount(research.db,'state',moduleIdentityPrefix);if(actual!==count)damaged();
 });
}
