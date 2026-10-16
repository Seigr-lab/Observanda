// Build and validate a command against its declared transaction participants.
// Persistence and replay belong to the calling legacy or domain command owner.
import {randomUUID} from 'node:crypto';
import {AppError} from '../errors.js';
import {uuid,requireValue} from './validation.js';
import {moduleCommandOriginals} from './constraints.js';
import {moduleConstraintSource} from './constraint-source.js';
import {withScratch} from '../scratch-work.js';
export async function prepareModuleCommand(owner,catalogue,head,research,command,fingerprint){
 const {book}=research;
 const originals=await moduleCommandOriginals(catalogue,head,command),changed=new Map(),created=new Set(),now=new Date().toISOString();
 for(const entity of originals.values())if(entity)owner.validateEntity(entity);
 return withScratch(async work=>{
 const source=moduleConstraintSource(catalogue,head,changed,{work,originals});
 const get=id=>{
  if(changed.has(id))return changed.get(id);
  if(originals.has(id))return originals.get(id)??undefined;
  throw new AppError('MODULE_FORMAT');
 };
 const tx={workspace:owner.workspace,book,hasRecord:research.hasRecord,recordSummary:research.recordSummary,externalReference:research.externalReference,now,get,
  some:source.some,has:source.has,balance:source.balance,
  expect(id,revision){if((get(id)?.revision??null)!==revision)throw new AppError('MODULE_CHANGED',[{field:id}]);},
  put(type,id,data){
   requireValue(uuid(id)&&!!owner.definitions.types[type],'item');const old=changed.get(id)??originals.get(id);requireValue(!old||old.type===type,'item type');
   if(!originals.has(id)){originals.set(id,null);created.add(id);}
   const entity={id,type,revision:old?(changed.has(id)?old.revision:old.revision+1):1,createdAt:old?.createdAt??now,updatedAt:now,data:structuredClone(data)};
   owner.validateEntity(entity);changed.set(id,entity);return entity;
  }
 };
 await owner.definitions.commands[command.action](tx,command.payload);
 requireValue(changed.size>0,'No changes');
 for(const id of created)if(await catalogue.member(head,id))throw new AppError('MODULE_CHANGED');
 const types=new Set([...changed.values()].map(e=>e.type));
 await owner.validateSource(source,types);
 return owner.validateEvent({id:randomUUID(),commandId:command.commandId,fingerprint,action:command.action,at:now,changes:[...changed.values()]});
 });
}
