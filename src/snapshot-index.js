import {referenceNamespaceMatches} from './research-reference-namespace.js';
// Persistent snapshot membership reuses the authenticated object tree. Nodes and
// member summaries are immutable; a snapshot pins its root, so later changes
// cannot alter earlier ownership, record order or workflow references.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {buildIndex} from './index-builder.js';
import {RecordSearchIndex} from './record-search-index.js';
import {CatalogueReadCache} from './catalogue-read-cache.js';
import {validRecordDate} from './web/record-date.js';
import {RecordMemberCollections,validMemberCollections} from './record-member-collections.js';
import {withScratch} from './scratch-work.js';
import {catalogueFormat} from './catalogue-format.js';
const hash=value=>digest(serialize(value));
const id=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const validMember=row=>row&&id(row.id)&&revision(row.revision)&&(row.notebookId===undefined||id(row.notebookId))&&
 (row.share===undefined||typeof row.share==='boolean')&&
 (row.occurredOn===undefined||validRecordDate(row.occurredOn))&&
 (row.updatedAt===undefined||typeof row.updatedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.updatedAt)&&Number.isFinite(Date.parse(row.updatedAt)))&&
 (row.template===undefined||row.template===null||id(row.template.id)&&typeof row.template.label==='string'&&row.template.label.length<=160)&&
 (row.cardItems===undefined||row.cardItems&&Object.keys(row.cardItems).sort().join()==='attachments,contributors,figures,relations'&&Object.values(row.cardItems).every(values=>Array.isArray(values)&&values.every(id)&&new Set(values).size===values.length))&&
 (row.queryRevision===undefined||revision(row.queryRevision)&&id(row.notebookId))&&
 (row.summaryRevision===undefined||revision(row.summaryRevision)&&revision(row.queryRevision))&&
 (row.collections?validMemberCollections(row.collections)&&row.sections===undefined&&row.cardItems===undefined:Array.isArray(row.sections)&&row.sections.every(id))&&
 Array.isArray(row.runOf)&&row.runOf.every(target=>target&&id(target.id))&&Number.isSafeInteger(row.bytes)&&row.bytes>0;
export class SnapshotIndex extends ObjectIndex{
 constructor(store,{cacheSize=128,cacheMembers=false}={}){super(store,{namespace:'snapshot-index:',immutable:true,cacheSize});this.memberRows=cacheMembers?new CatalogueReadCache():null;}
 static valid(ref){return validIndexRef(ref);}
 async member(entry){
  if(!entry)return null;
  const slot='record-member:'+entry.revision,load=()=>this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  const cache=this.memberRows??this.store.readCache,row=cache?await cache.row(slot,load):await load();
  const value=this.store.decode('state',slot,row?.payload);
  if(!validMember(value)||!Number.isSafeInteger(value.position)||value.position<0||hash(value)!==entry.revision)fail();
  if(value.collections&&await catalogueFormat(this.store.db)<6)fail();
  return value;
 }
 async get(root,recordId){
  const row=await this.member(await this.find({root},'record:'+recordId));
  if(row&&row.id!==recordId)fail();return row;
 }
 // Count a lab-book branch through authenticated subtree counts, without
 // enumerating its records. A null scope counts all ownership entries; older
 // indexes with missing ownership cannot safely service a scoped command.
 async scopedCount(root,notebookId=null){
  const prefix=notebookId===null?'book:':'book:'+notebookId+':';
  const before=async boundary=>{
   let ref=root,total=0,lower=null,upper=null;
   while(ref){
    const node=await this.node(ref,lower,upper);
    if(node.id<boundary){total+=1+(node.left?.count??0);lower=node.id;ref=node.right;}
    else{upper=node.id;ref=node.left;}
   }
   return total;
  };
  return await before(prefix+'\uffff')-await before(prefix);
 }
 async *members(root,{after=null,notebookId=null}={}){
  const prefix=notebookId===null?'record:':'book:'+notebookId+':';
  for await(const entry of this.entries({root},prefix,after===null?null:prefix+after)){
   const row=await this.member(entry);if(entry.id!==prefix+row.id||notebookId!==null&&row.notebookId!==notebookId)fail();yield row;
  }
 }
 async *keys(row){
  yield 'record:'+row.id;if(row.notebookId)yield 'book:'+row.notebookId+':'+row.id;yield 'identity:'+row.id;
  for await(const id of new RecordMemberCollections(this.store).ids(row,'sections'))yield 'identity:'+id;
  for(const target of row.runOf)yield 'run:'+target.id+':'+row.id;
 }
 async retain(row){
  if(!validMember(row)||!Number.isSafeInteger(row.position)||row.position<0)fail();
  const version=hash(row),slot='record-member:'+version;
  // Reusing a hash never repairs corrupted retained content silently.
  const prior=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  if(prior){if(hash(this.store.decode('state',slot,prior.payload))!==version)fail();}
  else await this.store.db.run('INSERT INTO state VALUES ($1,$2)',slot,this.store.encode('state',slot,row));
  return version;
 }
 async build(rows){
  const self=this;
  async function* entries(){for await(const row of rows){const revision=await self.retain(row);for await(const id of self.keys(row))yield {id,revision};}}
  return buildIndex(this.store,this,entries(),fail);
 }
 async replace(root,before,after){
  // Ordinary edits change only a few identity keys. Keep that bounded set in
  // memory; large commands spill the same iterator into encrypted scratch.
  const index=this;
  async function* changed(){for(const row of after){const version=await index.retain(row);for await(const key of index.keys(row))yield {key,version};}}
  const source=changed(),memory=new Map();
  const apply=async entries=>{
   for(const row of before)for await(const key of this.keys(row))if(!await entries.has(key)){root=await this.change(root,key,null);if(this.pending.size>=256)await this.flush(root);}
   for await(const {key,version} of entries.items()){root=await this.change(root,key,version);if(this.pending.size>=256)await this.flush(root);}
   await this.flush(root);return root;
  };
  try{
   for(;;){
    const item=await source.next();
    if(item.done)return apply({has:key=>memory.has(key),items:()=>memory.values()});
    if(memory.has(item.value.key))fail();
    if(memory.size<256){memory.set(item.value.key,item.value);continue;}
    return await withScratch(async entries=>{
     for(const value of memory.values())if(!await entries.add(value.key,value))fail();memory.clear();
     if(!await entries.add(item.value.key,item.value))fail();
     for await(const value of source)if(!await entries.add(value.key,value))fail();
     return apply(entries);
    });
   }
  }finally{await source.return();}
 }
 async validationRows(root,records){
  const found=new Map(),changed=new Set(records.map(r=>r.id));
  // Many section identities point to the same immutable record descriptor.
  // Keep bounded reuse inside this validation only, never across transactions.
  const descriptors=new Map(),collections=new RecordMemberCollections(this.store);let descriptorBytes=0;
  const member=async entry=>{
   if(!entry)return null;
   if(descriptors.has(entry.revision))return descriptors.get(entry.revision).row;
   const row=await this.member(entry);
   const bytes=Buffer.byteLength(serialize(row));
   if(bytes<=256*1024){
    while(descriptors.size>=128||descriptorBytes+bytes>256*1024){const first=descriptors.keys().next().value;descriptorBytes-=descriptors.get(first).bytes;descriptors.delete(first);}
    descriptors.set(entry.revision,{row,bytes});descriptorBytes+=bytes;
   }
   return row;
  };
  const add=(row,section=null,reference=null)=>{if(row){const prior=found.get(row.id)??{...row,sections:[]};if(section&&!prior.sections.includes(section))prior.sections.push(section);if(reference){prior.referenceNamespaces??=[];if(!prior.referenceNamespaces.includes(reference.workspaceId))prior.referenceNamespaces.push(reference.workspaceId);}found.set(row.id,prior);}};
  for(const record of records){
   for(const key of [record.id,...(record.sections??[]).map(s=>s.id)]){
    if(!id(key))continue;const row=await member(await this.find({root},'identity:'+key));
    if(row&&row.id!==key&&await collections.position(row,'sections',key)<0)fail();add(row,row&&row.id!==key?key:null);
   }
   for(const link of record.relations??[])if(link.role==='run-of'&&id(link.target?.id)&&await referenceNamespaceMatches(this.store,link.target))add(await this.get(root,link.target.id),null,link.target);
   // Only turning an investigation into a run can invalidate unchanged children.
   // One unaffected child is enough to reject it; changed children are checked
   // by the shared validator alongside the command's other changed records.
   if(record.type==='run')for await(const entry of this.entries({root},'run:'+record.id+':')){
    const row=await this.member(entry);
    if(entry.id!=='run:'+record.id+':'+row.id||!row.runOf.some(target=>target.id===record.id))fail();
    if(!changed.has(row.id)){const references=[];for(const target of row.runOf)if(target.id===record.id&&await referenceNamespaceMatches(this.store,target))references.push(target);if(references.length){for(const target of references)add(await this.get(root,record.id),null,target);add(row);break;}}
   }
  }
  return [...found.values()];
 }
 async rows(snapshot){
  const rows=[];let bytes=0;
  for await(const row of this.members(snapshot.membership)){rows.push(row);bytes+=row.bytes;}
  if(rows.length!==snapshot.count||bytes!==snapshot.bytes||new Set(rows.map(row=>row.position)).size!==rows.length||rows.some(row=>row.position>=snapshot.nextPosition))fail();
  return rows;
 }
 async verify(snapshot){
  const head={root:snapshot.membership},positions=snapshot.searchIndex?new RecordSearchIndex(this.store):null;
  let count=0,bytes=0,keys=0;
  for await(const row of this.members(snapshot.membership)){
   if(row.position>=snapshot.nextPosition)fail();
   count++;bytes+=row.bytes;const revision=hash(row);
   // Every required key must point to this exact member. Conflicting identities
   // cannot satisfy both proofs; equal cardinality also rejects extra keys.
   for await(const key of this.keys(row)){if((await this.find(head,key))?.revision!==revision)fail();keys++;}
   if(positions&&await positions.positionRevision(snapshot.searchIndex,row.position)!==revision)fail();
  }
  if(count!==snapshot.count||bytes!==snapshot.bytes||keys!==(snapshot.membership?.count??0))fail();
  let actual=0;for await(const entry of this.entries(head)){void entry;actual++;}
  if(actual!==keys)fail();
  if(!positions){
   // Older retained roots have no position lookup. Check fixed-size windows,
   // skipping empty ranges, without allocating a set proportional to the book.
   let lower=0;
   while(lower<snapshot.nextPosition){
    const upper=Math.min(Number.MAX_SAFE_INTEGER,lower+4096),seen=new Set();let next=Infinity;
    for await(const row of this.members(snapshot.membership)){
     if(row.position>=upper)next=Math.min(next,row.position);
     else if(row.position>=lower){if(seen.has(row.position))fail();seen.add(row.position);}
    }
    lower=next;
   }
  }
  return {count,bytes};
 }
}
