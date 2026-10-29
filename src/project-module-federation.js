// A command sees only its declared owners; routing an ID grants no new scope.
import {moduleDomain} from './modules/domains.js';
import {AppError} from './errors.js';
export async function projectModuleFederation(identities,domains){
 const selected=new Set(domains),owners=new Map();for(const domain of domains)owners.set(domain,await identities.owner(domain));
 const head={workspaceId:identities.registry.namespaceId,currentVersion: [...owners.values()].every(o=>o.head.revision===0||o.head.currentVersion===1)?1:undefined};
 async function locate(id){const value=await identities.locate('entity',id);if(!value)return null;if(!selected.has(value.domain))throw new AppError('MODULE_REFERENCE');return owners.get(value.domain);}
 return {head,owners,
  async selected(_head,id){const owner=await locate(id);return owner?owner.catalogue.selected(owner.head,id):null;},
  async member(_head,id){const owner=await locate(id);return owner?owner.catalogue.member(owner.head,id):null;},
  async *members(_head,{types=null,signal}={}){const domains=types===null?null:new Set((Array.isArray(types)?types:[types]).map(moduleDomain));if(domains&&[...domains].some(d=>!selected.has(d)))throw new AppError('INVALID');for(const [domain,owner] of owners){signal?.throwIfAborted();if(!domains||domains.has(domain))yield* owner.catalogue.members(owner.head,{signal});}},
  async constraint(_head,member){const owner=await locate(member.id);if(!owner)throw new AppError('CATALOGUE_DAMAGED');return owner.catalogue.constraint(owner.head,member);}
 };
}
