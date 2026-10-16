// Source ownership tools need a retired member's identity, not its private body.
import {retiredModuleSourceOwner} from './project-retired-modules.js';
import {AppError} from './errors.js';
export async function projectSourceModuleEntry(catalogue,head,id){
 const store=catalogue.store,member=await catalogue.member(head,id),row=await store.db.get('SELECT id,revision,payload FROM module_entities WHERE id=$1',id);
 if(!member){if(row)throw new AppError('CATALOGUE_DAMAGED');return null;}
 if(!row||row.revision!==member.revision)throw new AppError('CATALOGUE_DAMAGED');
 const raw=store.decode('module-entity',id+'/'+row.revision,row.payload),owner=await retiredModuleSourceOwner(store,raw,{kind:'entity',id,revision:row.revision,hash:member.hash});
 const value=owner?raw:await catalogue.selected(head,id,row);if(member.type!==undefined&&member.type!==value.type)throw new AppError('CATALOGUE_DAMAGED');
 return {identity:{id,type:value.type,createdAt:value.createdAt},hash:member.hash,type:value.type,revision:row.revision,...(owner?{retired:true,owner}:{retired:false,value})};
}
