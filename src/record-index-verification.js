// Incremental audits are valid only after the previous snapshot has been fully
// verified in the same repeatable-read transaction. Expected changes come from
// authenticated record descriptors, not from the derived index being checked.
import {SnapshotIndex} from './snapshot-index.js';
import {RecordSearchIndex} from './record-search-index.js';
import {withScratch} from './scratch-work.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {verifyIndexChanges} from './index-change-verification.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));

async function audit(index,oldRoot,newRoot,changes,keys){
 await withScratch(async work=>{
  const pending=new Map();let expectedCount=oldRoot?.count??0;
  async function flush(){
   const entries=[...pending];
   for(let offset=0;offset<entries.length;offset+=32){
    const batch=entries.slice(offset,offset+32),prior=await work.getMany(batch.map(([id])=>id));
    for(const [id,value] of batch){
     const previous=prior.get(id);if(!previous)continue;
     for(const side of ['before','after']){if(value[side]!==null&&previous[side]!==null)fail();value[side]??=previous[side];}
    }
    await work.putMany(batch);
   }
   pending.clear();
  }
  for await(const change of changes)for(const side of ['before','after']){
   const row=change[side];if(!row)continue;const revision=hash(row);
   for await(const id of await keys(row)){
    expectedCount+=side==='before'?-1:1;
    const value=pending.get(id)??{id,before:null,after:null};if(value[side]!==null)fail();
    value[side]=revision;pending.set(id,value);if(pending.size===2048)await flush();
   }
  }
  await flush();if(expectedCount!==(newRoot?.count??0))fail();
  await verifyIndexChanges(index,{root:oldRoot},{root:newRoot},work,(item,before,after)=>{if(before!==item.before||after!==item.after)fail();});
 });
}
async function* records(index,before,after){
 for await(const change of index.differences(before.membership,after.membership,'record:')){
  const a=await index.member(change.before),b=await index.member(change.after);
  if(a&&change.id!=='record:'+a.id||b&&(change.id!=='record:'+b.id||b.position>=after.nextPosition))fail();
  yield {before:a,after:b};
 }
}
// Membership has already been checked. With unchanged validation metadata,
// only changed originals need validation: identity collisions are covered by
// membership, and validationRows checks both a run's parent and the children
// of an investigation changed into a run. Deleted targets remain references.
export async function* changedVerificationMembers(store,before,after){
 const index=new SnapshotIndex(store,{cacheSize:4096});
 for await(const change of records(index,before,after))if(change.after)yield change.after;
}
export async function verifyIndexedDelta(store,parent,snapshot){
 if(!parent.indexVersion||!snapshot.indexVersion)return false;
 const index=new SnapshotIndex(store,{cacheSize:4096}),changed=new Set(snapshot.delta.changed),removed=new Set(snapshot.delta.removed??[]);
 if(snapshot.count!==parent.count-removed.size)fail();
 for(const id of changed){
  const before=await index.get(parent.membership,id),after=await index.get(snapshot.membership,id);
  if(!before||!after||before.position!==after.position)fail();
 }
 for(const id of removed)if(!await index.get(parent.membership,id)||await index.get(snapshot.membership,id))fail();
 for await(const change of records(index,parent,snapshot)){
  if(!change.before||change.after&&(!changed.has(change.after.id)||change.before.position!==change.after.position)||!change.after&&!removed.has(change.before.id))fail();
 }
 return true;
}
export async function verifyMembershipChange(store,before,after){
 if(!before?.indexVersion||!after.indexVersion||!RecordSearchIndex.valid(before.searchIndex)||!RecordSearchIndex.valid(after.searchIndex)||after.nextPosition<before.nextPosition)return false;
 const index=new SnapshotIndex(store,{cacheSize:4096});let count=before.count,bytes=before.bytes;
 async function* changes(){for await(const change of records(index,before,after)){
  count+=Number(Boolean(change.after))-Number(Boolean(change.before));bytes+=(change.after?.bytes??0)-(change.before?.bytes??0);yield change;
 }}
 await audit(index,before.membership,after.membership,changes(),row=>index.keys(row));
 if(count!==after.count||bytes!==after.bytes)fail();return true;
}
export async function verifyDerivedRecordChange(store,index,field,before,after){
 if(!before?.indexVersion||!after.indexVersion||!index.constructor.valid(before[field])||!index.constructor.valid(after[field])||before[field].version!==after[field].version)return false;
 const members=new SnapshotIndex(store,{cacheSize:4096});
 await audit(index,before[field].root,after[field].root,records(members,before,after),async row=>{if(index.keys)return index.keys(row,after[field].version);const key=await index.key(row);return key===null?[]:[key];});
 return true;
}
