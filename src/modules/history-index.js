// Immutable per-item revision locators. The encrypted module head declares
// exactly which revisions predate the index; a missing newer locator is damage.
import {AppError} from '../errors.js';
import {digest,serialize} from '../storage-format.js';
import {uuid,instant,exact} from './validation.js';
const hash=value=>digest(serialize(value));
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const slot=(id,revision)=>'module-history:'+id+':'+revision;
export function moduleHistorySummary(event,entity,ordinal,eventHash=hash(event)){
 return {format:1,entityId:entity.id,revision:entity.revision,commandId:event.commandId,ordinal,eventHash,entityHash:hash(entity),at:event.at,action:event.action};
}
export class ModuleHistoryIndex{
 constructor(store){this.store=store;}
 async append(event,ordinal){
  const eventHash=hash(event);
  for(const entity of event.changes){
   const key=slot(entity.id,entity.revision),value=moduleHistorySummary(event,entity,ordinal,eventHash);
   try{await this.store.db.run('INSERT INTO state VALUES ($1,$2)',key,this.store.encode('state',key,value));}
   catch(error){if(error.code==='23505')fail();throw error;}
  }
 }
 async read(id,revision){
  const key=slot(id,revision),row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',key);if(!row)fail();
  const value=this.store.decode('state',key,row.payload);
  if(!exact(value,['format','entityId','revision','commandId','ordinal','eventHash','entityHash','at','action'])||value.format!==1||value.entityId!==id||value.revision!==revision||!uuid(value.commandId)||!Number.isSafeInteger(value.ordinal)||value.ordinal<1||!instant(value.at)||typeof value.action!=='string'||!['eventHash','entityHash'].every(k=>/^[a-f0-9]{64}$/.test(value[k])))fail();
  return value;
 }
 async verify(event,entity,ordinal,eventHash){
  const value=await this.read(entity.id,entity.revision);
  if(serialize(value)!==serialize(moduleHistorySummary(event,entity,ordinal,eventHash)))fail();
 }
}
