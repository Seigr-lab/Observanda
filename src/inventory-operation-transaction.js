// Each callback owns exactly one short database transaction and no remote reader.
import {randomUUID} from 'node:crypto';
export {inventoryPhaseId} from './inventory-operation-identity.js';
import {ProjectDomains} from './project-domains.js';
import {ProjectModuleIdentities,moduleEventHash} from './project-module-identities.js';
import {projectModuleFederation} from './project-module-federation.js';
import {workspaceModules} from './modules/index.js';
import {moduleCommandFingerprint} from './modules/command-fingerprint.js';
import {moduleConstraintSource} from './modules/constraint-source.js';
import {withScratch} from './scratch-work.js';
import {replayProjectModuleEvent,writeProjectModuleEvent} from './project-module-event.js';
import {InventoryOperationStore} from './inventory-operation-store.js';
import {AppError} from './errors.js';

export async function inventoryOwnerTransaction(storage,workspaceId,domain,options,operation){
 const write=options.write?[domain]:[],participants=options.events?['bom','inventory']:[domain];
 for(let attempt=0;;attempt++)try{return await new ProjectDomains(storage,workspaceId).run(participants,async(_get,context)=>{
  const store=await context.inspect(domain),journal=new InventoryOperationStore(store),identities=new ProjectModuleIdentities(context.research,context.registry,context.inspect);
  const federation=await projectModuleFederation(identities,participants),owner=workspaceModules(storage),plan={primary:domain,read:participants.filter(value=>value!==domain).sort(),write:[domain]};
  const selected=id=>federation.selected(federation.head,id);
  async function event(command,mutate){
   if(!options.events)throw new AppError('INVALID');const fingerprint=moduleCommandFingerprint(command),receipt=await identities.locate('command',command.commandId);
   if(receipt){const result=await replayProjectModuleEvent({owner,identities,federation,plan,command,fingerprint,receipt}),fragments=await identities.fragments(receipt),fragment=fragments.find(f=>f.domain===domain);return {result,event:fragment.event,evidence:{commandId:command.commandId,id:fragment.event.id,ordinal:receipt.fragments.find(f=>f.domain===domain).ordinal,hash:moduleEventHash(fragment.event)}};}
   if(!options.write)throw new AppError('CATALOGUE_DAMAGED');
   return withScratch(async work=>{
    const originals=new Map(),changed=new Map(),now=new Date().toISOString();
    const get=async id=>{if(changed.has(id))return changed.get(id);if(!originals.has(id))originals.set(id,await selected(id));return originals.get(id);};
    const put=async(type,id,data)=>{const old=await get(id);if(old&&old.type!==type)throw new AppError('MODULE_FORMAT');const value={id,type,revision:old?(changed.has(id)?old.revision:old.revision+1):1,createdAt:old?.createdAt??now,updatedAt:now,data:structuredClone(data)};owner.validateEntity(value);changed.set(id,value);return value;};
    const source=moduleConstraintSource(federation,federation.head,changed,{work,originals});await mutate({get,put,source,now});if(!changed.size)throw new AppError('MODULE_FORMAT');
    await owner.validateSource(source,new Set([...changed.values()].map(e=>e.type)));const event={id:randomUUID(),commandId:command.commandId,fingerprint,action:command.action,at:now,changes:[...changed.values()]};
    const ordinal=federation.owners.get(domain).head.revision+1,result=await writeProjectModuleEvent({owner,identities,federation,plan,command,fingerprint,event});
    return {result,event,evidence:{commandId:command.commandId,id:event.id,ordinal,hash:moduleEventHash(event)}};
   });
  }
  return operation({store,journal,selected,event,context,identities,federation,plan,owner,book:async()=>(await context.research.snapshot()).metadata});
 },{write,consistent:true,check:options.check,signal:options.signal});}catch(error){if(!['40001','40P01'].includes(error.code)||attempt>=2)throw error;options.signal?.throwIfAborted();}
}
