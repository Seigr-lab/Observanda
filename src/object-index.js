import {catalogueIndexedCount,cataloguePrefixExists} from './postgres-indexes.js';
// Authenticated AVL index for encrypted metadata objects. The root pins each
// branch's hash; one object edit changes only its search path and rotations.
// All calls run in the catalogue's existing transaction: writers hold its lock,
// readers use a repeatable-read snapshot. Nodes never outlive their objects.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {writeCatalogueRows} from './catalogue-writes.js';
// Owner tracking reaches the catalogue; load it only during asynchronous writes.
async function retainRecordOwnerResource(...args){const owner=await import('./record-owner-resources.js');return owner.retainRecordOwnerResource(...args);}
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identifier=value=>typeof value==='string'&&value.length>0;
const height=ref=>ref?.height??0,count=ref=>ref?.count??0;
export const validIndexRef=ref=>ref===null||ref&&Object.keys(ref).sort().join()==='count,hash,height,key'&&revision(ref.key)&&revision(ref.hash)&&Number.isSafeInteger(ref.height)&&ref.height>0&&ref.height<=76&&Number.isSafeInteger(ref.count)&&ref.count>=ref.height;
// Frozen branch descriptors keep their checked shape for their entire lifetime.
// Mutable/deserialized values still pass the complete validation.
const validatedRefs=new WeakSet();
const validRef=ref=>{
 if(ref===null)return true;if(validatedRefs.has(ref))return true;
 if(!validIndexRef(ref))return false;
 if(Object.isFrozen(ref))validatedRefs.add(ref);return true;
};
const equal=(a,b)=>a?.hash===b?.hash;
const authenticatedNodes=new WeakMap();
const validNode=node=>node&&Object.keys(node).sort().join()==='id,left,revision,right'&&identifier(node.id)&&revision(node.revision)&&validRef(node.left)&&validRef(node.right)&&Math.abs(height(node.left)-height(node.right))<=1;
export class ObjectIndex{
 constructor(store,{namespace='object-index:',immutable=false,nodeStorage=null,authenticateOnWrite=false,cacheReads=false,scanAhead=false,cacheSize=128,write=null}={}){
  if(!Number.isSafeInteger(cacheSize)||cacheSize<1||cacheSize>16384)throw new AppError('INVALID');
  if(write!==null&&(typeof write!=='function'||!immutable||nodeStorage))throw new AppError('INVALID');
  if(typeof authenticateOnWrite!=='boolean'||authenticateOnWrite&&(immutable!==true||typeof nodeStorage?.read!=='function'||typeof nodeStorage?.write!=='function'))throw new AppError('INVALID');
  this.write=write;this.store=store;this.cacheReads=cacheReads;this.scanAhead=scanAhead;this.cacheSize=cacheSize;this.nodeStorage=nodeStorage;this.authenticateOnWrite=authenticateOnWrite;this.namespace=namespace;this.immutable=immutable;this.cache=new Map();this.cachedVersions=new Map();this.pending=new Map();this.writes=new Map();
  this.cacheBytes=0;this.nodeBytes=new WeakMap();this.pendingBytes=0;
 }
 forgetCached(version){
  const node=this.cache.get(version);if(!node)return;
  this.cache.delete(version);this.cacheBytes-=this.nodeBytes.get(node);
  if(!this.immutable)this.cachedVersions.delete(authenticatedNodes.get(node)?.key??digest(node.id));
 }
 cacheNode(ref,node){
  // A mutable tree has one retained version per key. Superseded hashes must
  // not crowd its bounded cache after each metadata checkpoint. Immutable
  // indexes may still need different retained versions of the same key.
  if(!this.immutable){const previous=this.cachedVersions.get(ref.key);if(previous)this.forgetCached(previous);}
  this.forgetCached(ref.hash);
  const bytes=this.nodeBytes.get(node)??authenticatedNodes.get(node)?.bytes??Buffer.byteLength(serialize(node));this.nodeBytes.set(node,bytes);
  if(bytes>16*1024*1024)return;
  while(this.cache.size>=this.cacheSize||this.cacheBytes+bytes>16*1024*1024)this.forgetCached(this.cache.keys().next().value);
  if(!this.immutable)this.cachedVersions.set(ref.key,ref.hash);
  this.cache.set(ref.hash,node);this.cacheBytes+=bytes;
  this.store?.readCache?.keepNode(this.slot(ref),node,bytes);
 }
 authenticate(node,version){
  // Frozen node values cannot change after their hash has been checked. The
  // weak receipt disappears with the bounded node cache, rather than retaining
  // every branch visited during a large transaction.
  if(node.left)Object.freeze(node.left);if(node.right)Object.freeze(node.right);
  Object.freeze(node);
  if(validNode(node))authenticatedNodes.set(node,{hash:version,key:digest(node.id),height:1+Math.max(height(node.left),height(node.right)),count:1+count(node.left)+count(node.right),bytes:this.nodeBytes.get(node)??Buffer.byteLength(serialize(node))});
  return node;
 }
 slot(ref){return this.namespace+(this.immutable?ref.hash:ref.key);}
 async prefetch(ref){
  const cache=this.store.readCache;
  if(!this.immutable&&!this.scanAhead||this.nodeStorage||!cache?.readAhead||this.readingAhead||cache.rows.has(this.slot(ref)))return;
  this.readingAhead=true;
  try{
   // Five levels contain at most thirty-one nodes. Authenticate each parent before
   // following its references; ordinary node() calls still enforce caller bounds.
   let frontier=[ref];
   for(let level=0;level<5&&frontier.length;level++){
    await cache.prefetch(this.store.db,[...new Set(frontier.filter(item=>!this.pending.has(item.hash)&&!this.cache.has(item.hash)).map(item=>this.slot(item)))]);
    const next=[];
    for(const item of frontier){const node=await this.node(item);if(node.left)next.push(node.left);if(node.right)next.push(node.right);}
    frontier=next;
   }
  }finally{this.readingAhead=false;}
 }
 async readMissingNode(){fail();}
 async readNode(ref){
  if(this.nodeStorage)return this.nodeStorage.read(ref);
  // The shared cache holds frozen values only within this fixed catalogue
  // audit. node() still authenticates the value and validates every new bound.
  const cached=this.store.readCache?.node(this.slot(ref));if(cached)return cached;
  await this.prefetch(ref);if(this.cache.has(ref.hash))return this.cache.get(ref.hash);
  const slot=this.slot(ref),load=()=>this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  const row=this.store.readCache?await this.store.readCache.row(slot,load):await load();return row?this.store.decode('state',slot,row.payload):this.readMissingNode(ref);
 }
 async persistWith(operation){return this.write?this.write(operation):operation(this.store);}
 async flush(root){return this.flushRoots([root]);}
 async flushRoots(roots){
  if(!Array.isArray(roots))throw new AppError('INVALID');
  if(!this.immutable)throw new AppError('INVALID');
  // Retain only reachable new nodes; earlier roots continue to pin shared branches.
  // Authenticate retained rows before inserting missing nodes in bounded batches.
  // A large branch change must not require two SQL round trips for every node.
  let batch=[],bytes=0;const visited=new Set();
  const write=async()=>{
   if(!batch.length)return;
   await this.persistWith(async store=>{
    const found=new Map((await store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',batch.map(item=>item.slot))).map(row=>[row.slot,row.payload]));
    const rows=[];
    for(const {slot,node,version} of batch){
     if(found.has(slot)){if(hash(store.decode('state',slot,found.get(slot)))!==version)fail();}
     await retainRecordOwnerResource(store,{kind:'state',key:slot,revision:version},{present:found.has(slot),dependencies:[...([node.left,node.right].filter(Boolean).map(ref=>({kind:'state',key:this.slot(ref),revision:ref.hash}))),...(this.namespace==='record-member-collection:'?[{kind:'state',key:'record-member-item:'+node.revision,revision:node.revision}]:[])]});
     if(!found.has(slot))rows.push([slot,store.encode('state',slot,node)]);
    }
    await writeCatalogueRows(store.db,'state',rows,{create:true});
   });batch=[];bytes=0;
  };
  const visit=async ref=>{
   if(!ref||visited.has(ref.hash))return;const node=this.pending.get(ref.hash);if(!node)return;visited.add(ref.hash);
   await visit(node.left);await visit(node.right);
   if(this.nodeStorage){
    // Opted-in storage must authenticate existing bytes before publishing any
    // root. A staged owner completes that check in its bounded writer batch.
    const prior=this.authenticateOnWrite?null:await this.nodeStorage.read(ref);
    if(prior){if(hash(prior)!==ref.hash)fail();}else await this.nodeStorage.write(ref,node);
   }else{
    const size=this.nodeBytes.get(node)??Buffer.byteLength(serialize(node));
    if(batch.length&&(batch.length===32||bytes+size>256*1024))await write();
    batch.push({slot:this.slot(ref),node,version:ref.hash});bytes+=size;
   }
  };
  for(const root of roots)await visit(root);await write();
  if(!this.nodeStorage)for(let offset=0;offset<roots.length;offset+=32)await this.persistWith(async store=>{for(const root of roots.slice(offset,offset+32))if(root)await retainRecordOwnerResource(store,{kind:'state',key:this.slot(root),revision:root.hash},{present:true});});
  this.pending.clear();this.pendingBytes=0;this.writes.clear();
 }
 async assertEmpty(){
  if(await cataloguePrefixExists(this.store.db,'objects')||await cataloguePrefixExists(this.store.db,'state','object-index:'))fail();
 }
 async head(){
  const load=()=>this.store.db.get("SELECT payload FROM state WHERE slot='objects'");
  const row=this.store.readCache?await this.store.readCache.row('objects',load):await load();
  if(!row){
   await this.assertEmpty();
   return {formatVersion:2,root:null};
  }
  const value=this.store.decode('state','objects',row.payload);
  if(value?.formatVersion===undefined&&Array.isArray(value?.entries)){
   if(!value.entries.every(e=>e&&identifier(e.id)&&revision(e.revision))||new Set(value.entries.map(e=>e.id)).size!==value.entries.length)fail();
   if(!value.entries.length)await this.assertEmpty();
   return {legacy:value.entries};
  }
  if(value?.formatVersion!==2||!validRef(value.root))fail();
  if(value.root===null)await this.assertEmpty();
  return {formatVersion:2,root:value.root};
 }
 async node(ref,lower=null,upper=null){
  if(!ref||!validRef(ref))fail();
  let value=this.pending.get(ref.hash)??this.cache.get(ref.hash);
  if(this.cache.has(ref.hash)){const cached=this.cache.get(ref.hash);this.cache.delete(ref.hash);this.cache.set(ref.hash,cached);}
  const loaded=!value;if(loaded)value=await this.readNode(ref);
  let proof=authenticatedNodes.get(value);
  if(!proof){if(!validNode(value)||hash(value)!==ref.hash)fail();this.authenticate(value,ref.hash);proof=authenticatedNodes.get(value);}
  // A frozen value's authenticated identity is independent of the index
  // instance. Weak receipts retain no nodes after their bounded caches close.
  if(proof.hash!==ref.hash||proof.key!==ref.key||proof.height!==ref.height||proof.count!==ref.count||lower!==null&&value.id<=lower||upper!==null&&value.id>=upper)fail();
  if(loaded&&(this.immutable||this.cacheReads||this.store?.readCache))this.cacheNode(ref,value);
  return value;
 }
 make(id,revision,left=null,right=null){
  const node={id,revision,left,right},encoded=serialize(node),ref={key:digest(id),hash:digest(encoded),height:1+Math.max(height(left),height(right)),count:1+count(left)+count(right)},bytes=Buffer.byteLength(encoded);
  this.nodeBytes.set(node,bytes);if(!this.pending.has(ref.hash))this.pendingBytes+=bytes;
  this.authenticate(node,ref.hash);this.pending.set(ref.hash,node);this.writes.set(this.slot(ref),node);return ref;
 }
 async find(head,id){
  if(head.legacy)return head.legacy.find(e=>e.id===id)??null;
  let ref=head.root,lower=null,upper=null;
  while(ref){const node=await this.node(ref,lower,upper);if(id===node.id)return node;if(id<node.id){upper=node.id;ref=node.left;}else{lower=node.id;ref=node.right;}}
  return null;
 }
 async rank(head,boundary){
  if(head.legacy)return head.legacy.reduce((n,e)=>n+Number(e.id<boundary),0);
  let ref=head.root,total=0,lower=null,upper=null;
  while(ref){const node=await this.node(ref,lower,upper);
   if(node.id<boundary){total+=1+count(node.left);lower=node.id;ref=node.right;}
   else{upper=node.id;ref=node.left;}
  }return total;
 }
 async entryAt(head,ordinal){
  if(!Number.isSafeInteger(ordinal)||ordinal<0)throw new AppError('INVALID');
  if(head.legacy)return [...head.legacy].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)[ordinal]??null;
  let ref=head.root,lower=null,upper=null;
  while(ref){
   const node=await this.node(ref,lower,upper),left=count(node.left);
   if(ordinal===left)return {id:node.id,revision:node.revision};
   if(ordinal<left){upper=node.id;ref=node.left;}
   else{ordinal-=left+1;lower=node.id;ref=node.right;}
  }return null;
 }
 async prefixCount(head,prefix){
  // A prefix is a contiguous UTF-16 interval, including supplementary keys.
  let end=prefix.length;
  while(end&&prefix.charCodeAt(end-1)===65535)end--;
  const upper=end?prefix.slice(0,end-1)+String.fromCharCode(prefix.charCodeAt(end-1)+1):null;
  return (upper===null?head.legacy?.length??count(head.root):await this.rank(head,upper))-await this.rank(head,prefix);
 }
 async *entries(head,prefix='',after=null){
  if(head.legacy){for(const entry of [...head.legacy].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))if(entry.id.startsWith(prefix)&&(after===null||entry.id>after))yield entry;return;}
  yield* this.walk(head.root,prefix,after);
 }
 // Compare retained roots directly. Matching authenticated subtrees have the
 // same keys and values, so neither their nodes nor their payloads need reading.
 // The two ordered frontiers survive AVL rotations and retain only tree height.
 async *differences(before,after,prefix='',{signal,afterId=null}={}){
  signal?.throwIfAborted();
  if(!this.immutable||!validRef(before)||!validRef(after)||afterId!==null&&typeof afterId!=='string')throw new AppError('INVALID');
  const frontier=root=>root?[{ref:root,lower:null,upper:null}]:[],left=frontier(before),right=frontier(after);
  const boundary=async(ref,lower,upper,direction)=>{
   while(ref){signal?.throwIfAborted();const node=await this.node(ref,lower,upper);
    if(direction==='left'){upper=node.id;ref=node.left;}else{lower=node.id;ref=node.right;}
   }
  };
  const expand=async stack=>{
   const {ref,lower,upper}=stack.pop(),node=await this.node(ref,lower,upper),matches=node.id.startsWith(prefix);
   if(node.right&&(node.id<prefix||matches))stack.push({ref:node.right,lower:node.id,upper});
   if(matches&&(afterId===null||node.id>afterId))stack.push({entry:{id:node.id,revision:node.revision}});
   if(node.left&&node.id>prefix&&(afterId===null||node.id>afterId))stack.push({ref:node.left,lower,upper:node.id});
  };
  while(left.length||right.length){
   signal?.throwIfAborted();
   const a=left.at(-1),b=right.at(-1);
   if(a?.ref&&b?.ref&&a.ref.hash===b.ref.hash){
    // A root reference authenticates its count/height at its parent. Reject an
    // inconsistent reference even when its subtree is otherwise unchanged.
    if(a.ref.key!==b.ref.key||a.ref.count!==b.ref.count||a.ref.height!==b.ref.height)fail();
    // Identical authenticated content preserves its interior ordering. When
    // a rotation tightens a bound, check the extreme path against that bound;
    // widening it needs no new proof. Never rescan the complete shared branch.
    if(b.lower!==null&&(a.lower===null||b.lower>a.lower))await boundary(b.ref,b.lower,b.upper,'left');
    if(b.upper!==null&&(a.upper===null||b.upper<a.upper))await boundary(b.ref,b.lower,b.upper,'right');
    left.pop();right.pop();continue;
   }
   if(a?.ref||b?.ref){
    if(a?.ref&&(!b?.ref||a.ref.height>=b.ref.height))await expand(left);
    else await expand(right);
    continue;
   }
   if(!b||a&&a.entry.id<b.entry.id){left.pop();yield {id:a.entry.id,before:a.entry,after:null};}
   else if(!a||b.entry.id<a.entry.id){right.pop();yield {id:b.entry.id,before:null,after:b.entry};}
   else{
    left.pop();right.pop();
    if(a.entry.revision!==b.entry.revision)yield {id:a.entry.id,before:a.entry,after:b.entry};
   }
  }
 }
 async *reverseEntries(head,prefix='',before=null){
  if(head.legacy){for(const entry of [...head.legacy].sort((a,b)=>a.id<b.id?1:a.id>b.id?-1:0))if(entry.id.startsWith(prefix)&&(before===null||entry.id<before))yield entry;return;}
  yield* this.walkReverse(head.root,prefix,before);
 }
 async *walkReverse(ref,prefix,before=null,lower=null,upper=null){
  if(!ref)return;
  const node=await this.node(ref,lower,upper),matches=node.id.startsWith(prefix);
  if((node.id<prefix||matches)&&(before===null||node.id<before))yield* this.walkReverse(node.right,prefix,before,node.id,upper);
  if(matches&&(before===null||node.id<before))yield {id:node.id,revision:node.revision};
  if(node.id>prefix)yield* this.walkReverse(node.left,prefix,before,lower,node.id);
 }
 async *walk(ref,prefix,after=null,lower=null,upper=null){
  if(!ref)return;
  const node=await this.node(ref,lower,upper),matches=node.id.startsWith(prefix);
  // Every matching key is contiguous in JS string order. No database collation
  // or machine locale participates in the authenticated tree's ordering.
  if(node.id>prefix&&(after===null||node.id>after))yield* this.walk(node.left,prefix,after,lower,node.id);
  if(matches&&(after===null||node.id>after))yield {id:node.id,revision:node.revision};
  if(node.id<prefix||matches)yield* this.walk(node.right,prefix,after,node.id,upper);
 }
 async balance(id,revision,left,right){
  if(height(left)>height(right)+1){
   const l=await this.node(left,null,id);
   if(height(l.left)>=height(l.right))return this.make(l.id,l.revision,l.left,this.make(id,revision,l.right,right));
   const middle=await this.node(l.right,l.id,id);
   return this.make(middle.id,middle.revision,this.make(l.id,l.revision,l.left,middle.left),this.make(id,revision,middle.right,right));
  }
  if(height(right)>height(left)+1){
   const r=await this.node(right,id,null);
   if(height(r.right)>=height(r.left))return this.make(r.id,r.revision,this.make(id,revision,left,r.left),r.right);
   const middle=await this.node(r.left,id,r.id);
   return this.make(middle.id,middle.revision,this.make(id,revision,left,middle.left),this.make(r.id,r.revision,middle.right,r.right));
  }
  return this.make(id,revision,left,right);
 }
 async change(ref,id,revision,lower=null,upper=null){
  if(!ref)return revision===null?null:this.make(id,revision);
  const node=await this.node(ref,lower,upper);
  if(id<node.id){const left=await this.change(node.left,id,revision,lower,node.id);return equal(left,node.left)?ref:this.balance(node.id,node.revision,left,node.right);}
  if(id>node.id){const right=await this.change(node.right,id,revision,node.id,upper);return equal(right,node.right)?ref:this.balance(node.id,node.revision,node.left,right);}
  if(revision!==null)return revision===node.revision?ref:this.make(id,revision,node.left,node.right);
  if(!this.immutable)this.writes.set(this.slot(ref),null);
  if(!node.left||!node.right)return node.left??node.right;
  let successor=await this.node(node.right,node.id,upper);
  while(successor.left)successor=await this.node(successor.left,node.id,successor.id);
  const right=await this.change(node.right,successor.id,null,node.id,upper);
  return this.balance(successor.id,successor.revision,node.left,right);
 }
 async update(head,id,revision){
  if(!identifier(id)||revision!==null&&!/^[a-f0-9]{64}$/.test(revision))throw new AppError('INVALID');
  let root=head.root;
  if(head.legacy){
   // Existing flat indexes are replaced in place in the caller's transaction.
   // Workspace identity, object bytes and references are unchanged.
   await this.checkCounts(head);
   const entries=[...head.legacy].sort((a,b)=>a.id<b.id?-1:1);
   const build=(start,end)=>{if(start===end)return null;const mid=Math.floor((start+end)/2),entry=entries[mid];return this.make(entry.id,entry.revision,build(start,mid),build(mid+1,end));};
   root=build(0,entries.length);
  }
  root=await this.change(root,id,revision);
  await this.persist(root);
 }
 async persist(root){
  // Independent final node versions share bounded SQL messages. No plaintext
  // or dynamically interpolated identifiers are sent to PostgreSQL.
  const store=this.store;
  function* rows(writes){for(const [key,node] of writes)yield [key,node===null?null:store.encode('state',key,node)];}
  await writeCatalogueRows(this.store.db,'state',rows(this.writes));
  await this.store.db.run("INSERT INTO state VALUES ('objects',$1) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload",this.store.encode('state','objects',{formatVersion:2,root}));
  // Ordinary writers have no shared read cache. If an audit owner explicitly
  // mutates its own transaction, invalidate its earlier head and node receipts.
  this.store.readCache?.clear();
  if(this.cacheReads)for(const node of this.writes.values())if(node)this.cacheNode({key:authenticatedNodes.get(node)?.key??digest(node.id),hash:authenticatedNodes.get(node)?.hash??hash(node)},node);
  this.pending.clear();this.pendingBytes=0;this.writes.clear();
 }
 async checkCounts(head){
  const objects=await catalogueIndexedCount(this.store.db,'objects'),nodes=await catalogueIndexedCount(this.store.db,'state','object-index:');
  if(objects!==(head.legacy?.length??count(head.root))||nodes!==(head.legacy?0:count(head.root)))fail();
 }
}
