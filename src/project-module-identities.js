import {projectDomainSchema} from './project-domain-schema.js';
// Derived routes have one immutable row per identity, never a shared writer/head.
// Authenticated domain members/receipts remain authoritative for their contents.
import {ModuleCatalogue} from './modules/catalogue.js';
import {validModuleDomain} from './modules/domains.js';
import {uuid,exact,instant} from './modules/validation.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
export const moduleIdentityPrefix='project-module-identity:';
export const moduleEventHash=event=>digest(serialize(event));
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const sorted=values=>Array.isArray(values)&&values.every(validModuleDomain)&&new Set(values).size===values.length&&[...values].sort().join()===values.join();
export class ProjectModuleIdentities{
 constructor(research,registry,inspect){this.research=research;this.registry=registry;this.inspect=inspect;this.owners=new Map();if(registry?.commandVersion!==1)throw new AppError('ACCESS_UPGRADE');}
 async owner(domain){
  if(!this.registry.domains.includes(domain))damaged();
  if(!this.owners.has(domain)){const store=await this.inspect(domain),catalogue=new ModuleCatalogue(store);this.owners.set(domain,{store,catalogue,head:await catalogue.head(this.registry.namespaceId)});}
  return this.owners.get(domain);
 }
 slot(kind,id){if(!['entity','command'].includes(kind)||!uuid(id))throw new AppError('MODULE_FORMAT');return moduleIdentityPrefix+kind+':'+id;}
 validate(value,kind,id){
  const base=['version','kind','id','projectId','namespaceId'];
  if(!exact(value,[...base,...(kind==='entity'?['domain']:['primary','fingerprint','originHash','action','eventId','at','read','write','fragments'])])||value.version!==1||value.kind!==kind||value.id!==id||value.projectId!==this.registry.projectId||value.namespaceId!==this.registry.namespaceId)damaged();
  if(kind==='entity'){if(!this.registry.domains.includes(value.domain))damaged();}
  else if(!this.registry.domains.includes(value.primary)||typeof value.action!=='string'||value.originHash!==null&&!/^[a-f0-9]{64}$/.test(value.originHash)||!/^[a-f0-9]{64}$/.test(value.fingerprint)||!uuid(value.eventId)||!instant(value.at)||!sorted(value.read)||!sorted(value.write)||!value.write.includes(value.primary)||value.read.some(d=>value.write.includes(d))||[...value.read,...value.write].some(d=>!this.registry.domains.includes(d))||!Array.isArray(value.fragments)||!value.fragments.length||!sorted(value.fragments.map(f=>f.domain))||value.fragments.map(f=>f.domain).join()!==value.write.join()||!value.fragments.some(f=>f.domain===value.primary)||value.fragments.some(f=>!exact(f,['domain','ordinal','hash'])||!value.write.includes(f.domain)||!Number.isSafeInteger(f.ordinal)||f.ordinal<1||!/^[a-f0-9]{64}$/.test(f.hash)))damaged();
  return value;
 }
 async read(kind,id){const slot=this.slot(kind,id),row=await this.research.db.get('SELECT payload FROM state WHERE slot=$1',slot);return row?this.validate(this.research.decode('state',slot,row.payload),kind,id):null;}
 async locate(kind,id){
  const value=await this.read(kind,id);
  if(value){
   if(kind==='entity'){const {catalogue,head}=await this.owner(value.domain);if(!await catalogue.member(head,id))damaged();}
   return value;
  }
  // A missing route must not conceal an existing entity or receipt. Probe
  // their indexed identities in this snapshot without opening unrelated
  // owners, counting their history, or decrypting their payloads. Participating
  // owners validate their heads; the full audit validates every owner.
  const probes=this.registry.domains.flatMap(domain=>{
   const schema='"'+projectDomainSchema(this.research.db.id,domain)+'"';
   return kind==='entity'?[`SELECT 1 FROM ${schema}.module_entities WHERE id=$1`,`SELECT 1 FROM ${schema}.state WHERE slot='module-member:'||$1::text`]:[`SELECT 1 FROM ${schema}.module_events WHERE command_id=$1`];
  });
  if(await this.research.db.get('SELECT 1 FROM ('+probes.join(' UNION ALL ')+') AS identities LIMIT 1',id))damaged();
  return null;
 }
 value(kind,id,fields){return this.validate({version:1,kind,id,projectId:this.registry.projectId,namespaceId:this.registry.namespaceId,...fields},kind,id);}
 async claim(kind,id,fields){
  const value=this.value(kind,id,fields),slot=this.slot(kind,id),old=await this.read(kind,id);
  if(old){if(serialize(old)!==serialize(value))throw new AppError(kind==='command'?'MODULE_REPLAY':'MODULE_CHANGED');return old;}
  const inserted=await this.research.db.get('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO NOTHING RETURNING slot',slot,this.research.encode('state',slot,value));
  // Under repeatable-read a conflicting concurrent commit raises 40001. A
  // visible incompatible claim is never overwritten or accepted as a replay.
  if(!inserted)throw new AppError(kind==='command'?'MODULE_REPLAY':'MODULE_CHANGED');return value;
 }
 async fragments(receipt){
  const events=[];
  for(const fragment of receipt.fragments){const {catalogue,head}=await this.owner(fragment.domain),row=await catalogue.store.db.get('SELECT command_id,ordinal,payload FROM module_events WHERE command_id=$1',receipt.id);
   if(!row||row.ordinal!==fragment.ordinal||row.ordinal>head.revision)damaged();const event=await catalogue.event(row);
   if(moduleEventHash(event)!==fragment.hash||event.id!==receipt.eventId||event.fingerprint!==receipt.fingerprint||event.action!==receipt.action||event.at!==receipt.at)damaged();events.push({domain:fragment.domain,event});
  }
  return events;
 }
}
