import {catalogueIndexedCount} from '../postgres-indexes.js';
// Module membership uses the same authenticated tree as other catalogue
// indexes. Its root is pinned by the module head; each member pins the original
// and its derived facts. No lookup needs a workspace-sized identity array.
import {ObjectIndex,validIndexRef} from '../object-index.js';
import {writeCatalogueRows} from '../catalogue-writes.js';
import {digest,serialize} from '../storage-format.js';
import {AppError} from '../errors.js';
import {uuid} from './validation.js';
import {moduleStateRow} from './read-state.js';
const hash=value=>digest(serialize(value)),revision=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export function validModuleMember(e,head){
 return e&&uuid(e.id)&&revision(e.hash)&&Number.isSafeInteger(e.revision)&&e.revision>0&&
  (head.historyVersion!==1||Number.isSafeInteger(e.historyFrom)&&e.historyFrom>=0&&e.historyFrom<=e.revision)&&
  (head.currentVersion!==1||Number.isSafeInteger(e.bytes)&&e.bytes>0&&revision(e.constraintHash))&&
  (head.viewVersion!==1||revision(e.viewHash)&&revision(e.searchHash)&&typeof e.type==='string')&&
  (e.referencesHash===undefined||revision(e.referencesHash))&&
  ['calendarHash','inventoryHash'].every(key=>e[key]===undefined||e[key]===null||revision(e[key]));
}
export class ModuleMemberIndex{
 constructor(store){this.store=store;this.tree=new ObjectIndex(store,{namespace:'module-member-index:',cacheReads:true});}
 async check(head,count){
  if(head.memberVersion!==1||!validIndexRef(head.root)||String(head.root?.count??0)!==count)damaged();
  const members=await catalogueIndexedCount(this.store.db,'state','module-member:'),nodes=await catalogueIndexedCount(this.store.db,'state','module-member-index:');
  if(String(members)!==count||String(nodes)!==count)damaged();
 }
 async decode(head,entry){
  if(!entry)return null;
  const slot='module-member:'+entry.id,row=await moduleStateRow(this.store,slot);
  if(!row)damaged();const member=this.store.decode('state',slot,row.payload);
  if(member.id!==entry.id||hash(member)!==entry.revision||!validModuleMember(member,head))damaged();return member;
 }
 async find(head,id){return this.decode(head,await this.tree.find(head,id));}
 async *members(head,{signal}={}){
  const expected=this.tree.entries(head),store=this.store;let batch=[];
  const decode=row=>store.decode('state',row.slot,row.payload);
  const tree=this.tree;
  async function* consume(rows){
   // Prefetch only this page's proof nodes. Ordered SQL rows are not trusted:
   // the authenticated traversal must produce exactly the same identities.
   const slots=rows.map(row=>'module-member-index:'+digest(row.slot.slice('module-member:'.length)));
   for(const row of await store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',slots)){
    const node=decode(row);if(!node||!uuid(node.id))damaged();tree.cacheNode({key:digest(node.id),hash:hash(node)},node);
   }
   for(const row of rows){
    signal?.throwIfAborted();const next=await expected.next(),member=decode(row);
    if(next.done||row.slot!=='module-member:'+next.value.id||member?.id!==next.value.id||hash(member)!==next.value.revision||!validModuleMember(member,head))damaged();yield member;
   }
  }
  try{
   for await(const row of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C"',['module-member:','module-member;'],{batchSize:32,signal})){
    batch.push(row);if(batch.length===32){yield* consume(batch);batch=[];}
   }
   if(batch.length)yield* consume(batch);if(!(await expected.next()).done)damaged();
  }finally{await expected.return();}
 }
 async put(root,member){
  const slot='module-member:'+member.id;
  await this.store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',slot,this.store.encode('state',slot,member));
  const next=await this.tree.change(root,member.id,hash(member)),store=this.store;
  function* rows(writes){for(const [key,node] of writes)yield [key,node===null?null:store.encode('state',key,node)];}
  await writeCatalogueRows(store.db,'state',rows(this.tree.writes));
  for(const node of this.tree.writes.values())if(node)this.tree.cacheNode({key:digest(node.id),hash:hash(node)},node);
  this.tree.pending.clear();this.tree.pendingBytes=0;this.tree.writes.clear();return next;
 }
}
