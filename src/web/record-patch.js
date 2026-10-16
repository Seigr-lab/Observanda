// Reconcile a catalogue response with the exact saved base, never an unsaved
// form. Includes intervening changes from other windows and explicit deletions.
import {t} from './i18n/index.js';
const incomplete=()=>{throw Error(t('recordUpdates','incomplete'));};
const ids=values=>Array.isArray(values)&&values.every(id=>typeof id==='string'&&id.length>0);
export function applyRecordPatch(book,etag,revisions,result){
 const patch=result.recordPatch;
 if(!patch||patch.baseEtag!==etag||patch.metadata?.id!==book?.id)throw {code:'WORKSPACE_CHANGED',message:t('recordUpdates','reloadBase')};
 const appended=patch.appended??[];
 if(!ids(patch.removed)||!ids(appended)||!Array.isArray(patch.records)||
  patch.records.some(record=>!record||typeof record.id!=='string'||!record.id)||
  patch.order!==null&&!ids(patch.order)||patch.metadata.entries!==undefined&&(!Array.isArray(patch.metadata.entries)||patch.metadata.entries.length))incomplete();
 const removed=new Set(patch.removed),added=new Set(appended),changed=new Map(patch.records.map(record=>[record.id,record]));
 if(removed.size!==patch.removed.length||added.size!==appended.length||changed.size!==patch.records.length||
  appended.some(id=>removed.has(id)||!changed.has(id))||patch.records.some(record=>removed.has(record.id)))incomplete();
 const entries=[],recordRevisions={};
 const keep=record=>{
  const revision=changed.has(record.id)?result.recordRevisions?.[record.id]:revisions[record.id];
  if(typeof revision!=='string'||!revision)incomplete();
  entries.push(record);Object.defineProperty(recordRevisions,record.id,{value:revision,enumerable:true,writable:true,configurable:true});
 };
 if(patch.order===null){
  // Ordinary reconciliation retains only changed/deleted identities, plus the
  // resulting array. Do not rebuild a map and an order array of every record.
  if(patch.count!==book.entries.length-removed.size+added.size)incomplete();
  for(const record of book.entries){
   if(added.has(record.id))incomplete();
   if(removed.delete(record.id))continue;
   keep(changed.get(record.id)??record);changed.delete(record.id);
  }
  for(const id of appended){keep(changed.get(id));changed.delete(id);}
  if(removed.size||changed.size||entries.length!==patch.count)incomplete();
 }else{
  // Explicit order rewrites and flat legacy snapshots still need a full map.
  const records=new Map(book.entries.map(record=>[record.id,record]));
  for(const id of removed)if(!records.delete(id))incomplete();
  if(appended.some(id=>records.has(id)))incomplete();
  for(const record of patch.records)records.set(record.id,record);
  if(patch.order.length!==records.size||patch.count!==undefined&&patch.count!==records.size)incomplete();
  for(const id of patch.order){const record=records.get(id);if(!record)incomplete();keep(record);records.delete(id);}
 }
 // The reader owns admission for complete legacy snapshots; selected-record
 // transports have their own budgets. Applying an accepted delta must not
 // serialize unchanged bodies or charge them against a second legacy limit.
 return {book:{...patch.metadata,entries},recordRevisions};
}
