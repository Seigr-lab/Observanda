import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';

const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const hash=value=>digest(serialize(value));
const digestValue=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identifier=value=>typeof value==='string'&&value.length>0;
const natural=value=>Number.isSafeInteger(value)&&value>0;
const width=32;
export const validTableRef=ref=>ref===null||ref&&Object.keys(ref).sort().join()==='count,first,hash,height,last'&&digestValue(ref.hash)&&natural(ref.count)&&natural(ref.height)&&ref.height<=64&&identifier(ref.first)&&identifier(ref.last)&&ref.first<=ref.last;
const describe=node=>node.entries?{count:node.entries.length,height:1,first:node.entries[0].id,last:node.entries.at(-1).id}:{count:node.children.reduce((sum,ref)=>sum+ref.count,0),height:node.children[0].height+1,first:node.children[0].first,last:node.children.at(-1).last};
const lower=(items,key,value)=>{let start=0,end=items.length;while(start<end){const mid=Math.floor((start+end)/2);if(items[mid][key]<value)start=mid+1;else end=mid;}return start;};

// Persistent ordered table pages. Each encrypted page holds up to 32 entries
// or child references, instead of one separately indexed object per branch.
// Counts support direct ordinal seeks; authenticated first/last keys bound
// every child. Checkpoints retain roots without copying unchanged pages.
export class RetainedTableIndex{
 constructor(sequences,{namespace='table-nodes',allowSparseBranches=false}={}){this.namespace=namespace;this.allowSparseBranches=allowSparseBranches;this.sequences=sequences;this.pending=new Map();this.pendingBytes=0;this.cache=new Map();this.cacheBytes=0;}
 keep(ref,node){
  if(this.cache.has(ref.hash))return;const bytes=Buffer.byteLength(serialize(node));
  while(this.cache.size>=256||this.cacheBytes+bytes>4*1024*1024){const first=this.cache.keys().next().value;if(first===undefined)return;this.cacheBytes-=this.cache.get(first).bytes;this.cache.delete(first);}
  this.cache.set(ref.hash,{node,bytes});this.cacheBytes+=bytes;
 }
 validate(node,ref){
  if(!ref||!validTableRef(ref)||!node)fail();
  if(Object.keys(node).join()==='entries'){
   if(!Array.isArray(node.entries)||!node.entries.length||node.entries.length>width||!node.entries.every((entry,i)=>entry&&Object.keys(entry).sort().join()==='id,revision'&&identifier(entry.id)&&digestValue(entry.revision)&&(!i||node.entries[i-1].id<entry.id)))fail();
  }else if(Object.keys(node).join()==='children'){
   if(!Array.isArray(node.children)||node.children.length<(this.allowSparseBranches?1:2)||node.children.length>width||!node.children.every((child,i)=>child&&validTableRef(child)&&child.height===node.children[0].height&&(!i||node.children[i-1].last<child.first)))fail();
  }else fail();
  const expected=describe(node);if(hash(node)!==ref.hash||!natural(expected.count)||Object.keys(expected).some(key=>expected[key]!==ref[key]))fail();
  return node;
 }
 async node(ref){
  if(!ref||!validTableRef(ref))fail();
  const retained=this.cache.get(ref.hash);if(retained){this.cache.delete(ref.hash);this.cache.set(ref.hash,retained);}
  const cached=this.pending.get(ref.hash)??retained?.node;
  const node=this.validate(cached??await this.sequences.read(this.namespace,ref.hash),ref);
  if(!cached)this.keep(ref,node);return node;
 }
 make(node){const ref={hash:hash(node),...describe(node)};this.validate(node,ref);if(!this.pending.has(ref.hash))this.pendingBytes+=Buffer.byteLength(serialize(node));this.pending.set(ref.hash,node);return ref;}
 pack(key,items){if(items.length<=width)return [this.make({[key]:items})];const middle=Math.floor(items.length/2);return [this.make({[key]:items.slice(0,middle)}),this.make({[key]:items.slice(middle)})];}
 async change(root,id,revision){
  if(!validTableRef(root)||!identifier(id)||!digestValue(revision))throw new AppError('INVALID');
  const insert=async ref=>{
   const node=await this.node(ref);
   if(node.entries){
    const entries=[...node.entries],at=lower(entries,'id',id);
    if(entries[at]?.id===id){if(entries[at].revision===revision)return [ref];entries[at]={id,revision};}else entries.splice(at,0,{id,revision});
    return this.pack('entries',entries);
   }
   const children=[...node.children],at=Math.min(lower(children,'last',id),children.length-1),replacement=await insert(children[at]);
   if(replacement.length===1&&replacement[0].hash===children[at].hash)return [ref];
   children.splice(at,1,...replacement);return this.pack('children',children);
  };
  if(!root)return this.make({entries:[{id,revision}]});
  const roots=await insert(root);return roots.length===1?roots[0]:this.make({children:roots});
 }
 async remove(root,id){
  if(!this.allowSparseBranches||!validTableRef(root)||!identifier(id))throw new AppError('INVALID');
  const erase=async ref=>{
   if(!ref||id<ref.first||id>ref.last)return ref;
   const node=await this.node(ref);
   if(node.entries){
    const at=lower(node.entries,'id',id);if(node.entries[at]?.id!==id)return ref;
    const entries=node.entries.filter((_,i)=>i!==at);return entries.length?this.make({entries}):null;
   }
   const at=lower(node.children,'last',id),child=node.children[at],replacement=await erase(child);
   if(replacement===child)return ref;
   const children=[...node.children];children.splice(at,1,...(replacement?[replacement]:[]));
   return children.length?this.make({children}):null;
  };
  root=await erase(root);
  while(root?.height>1){const node=await this.node(root);if(node.children.length!==1)break;root=node.children[0];}
  return root;
 }
 // Apply a sorted batch through each affected branch once. Unchanged branches
 // retain their references; only the final pages of the batch need flushing.
 async changeMany(root,changes,{signal}={}){
  if(!this.allowSparseBranches||!validTableRef(root)||!Array.isArray(changes)||!changes.every((entry,i)=>entry&&Object.keys(entry).sort().join()==='id,revision'&&identifier(entry.id)&&(entry.revision===null||digestValue(entry.revision))&&(!i||changes[i-1].id<entry.id)))throw new AppError('INVALID');
  signal?.throwIfAborted();if(!changes.length)return root;
  const pack=(key,items)=>{
   if(!items.length)return [];const groups=Math.ceil(items.length/width),size=Math.ceil(items.length/groups),refs=[];
   for(let offset=0;offset<items.length;offset+=size)refs.push(this.make({[key]:items.slice(offset,offset+size)}));return refs;
  };
  const amend=async(ref,start,end)=>{
   signal?.throwIfAborted();if(start===end)return ref?[ref]:[];
   const node=ref?await this.node(ref):{entries:[]};
   if(node.entries){
    const entries=[];let at=0,next=start;
    while(at<node.entries.length||next<end){
     const prior=node.entries[at],change=changes[next];
     if(next===end||prior&&prior.id<change.id){entries.push(prior);at++;}
     else{if(change.revision!==null)entries.push(change);next++;if(prior?.id===change.id)at++;}
    }
    if(ref&&entries.length===node.entries.length&&entries.every((entry,i)=>entry.id===node.entries[i].id&&entry.revision===node.entries[i].revision))return [ref];
    return pack('entries',entries);
   }
   const children=[];let at=start;
   for(let i=0;i<node.children.length;i++){
    const child=node.children[i],begin=at;while(at<end&&(i===node.children.length-1||changes[at].id<=child.last))at++;
    children.push(...await amend(child,begin,at));
   }
   if(children.length===node.children.length&&children.every((child,i)=>child.hash===node.children[i].hash))return [ref];
   return pack('children',children);
  };
  let refs=await amend(root,0,changes.length);
  while(refs.length>1){signal?.throwIfAborted();refs=pack('children',refs);}
  root=refs[0]??null;while(root?.height>1){const node=await this.node(root);if(node.children.length!==1)break;root=node.children[0];}
  return root;
 }
 // Discard superseded in-memory pages without making an intermediate version
 // durable. Every live root (including paused readers) must be supplied. A
 // persisted parent cannot refer to a page that has never been persisted.
 pruneRoots(roots,{signal}={}){
  if(!Array.isArray(roots)||!roots.every(validTableRef))throw new AppError('INVALID');
  const retained=new Set();let bytes=0;
  const visit=ref=>{
   signal?.throwIfAborted();if(!ref)return;const node=this.pending.get(ref.hash);if(!node)return;
   this.validate(node,ref);if(retained.has(ref.hash))return;retained.add(ref.hash);
   bytes+=Buffer.byteLength(serialize(node));if(node.children)for(const child of node.children)visit(child);
  };
  for(const root of roots)visit(root);signal?.throwIfAborted();
  // Validation/cancellation must finish before changing the pending inventory.
  for(const key of this.pending.keys())if(!retained.has(key))this.pending.delete(key);
  this.pendingBytes=bytes;
 }
 async flush(root){return this.flushRoots([root]);}
 // A caller maintaining several roots must retain every live frontier before
 // pruning intermediate pages. Failed writes leave all pending nodes usable.
 async flushRoots(roots,{signal}={}){
  const visited=new Set();
  const visit=async ref=>{
   signal?.throwIfAborted();if(!ref||!this.pending.has(ref.hash))return;
   const node=await this.node(ref);if(visited.has(ref.hash))return;
   if(node.children)for(const child of node.children)await visit(child);
   signal?.throwIfAborted();const stored=await this.sequences.put(this.namespace,node);if(stored!==ref.hash)fail();this.keep(ref,node);visited.add(ref.hash);
  };
  for(const root of roots)await visit(root);
  signal?.throwIfAborted();this.pending.clear();this.pendingBytes=0;
 }
 async find({root},id){
  while(root){const node=await this.node(root);if(node.entries){const at=lower(node.entries,'id',id);return node.entries[at]?.id===id?node.entries[at]:null;}const at=lower(node.children,'last',id);root=node.children[at]??null;}return null;
 }
 async rank({root},id){
  let count=0;while(root){const node=await this.node(root);if(node.entries)return count+lower(node.entries,'id',id);let next=null;for(const child of node.children){if(child.last<id)count+=child.count;else{next=child;break;}}root=next;}return count;
 }
 async entryAt({root},ordinal){
  if(!Number.isSafeInteger(ordinal)||ordinal<0)throw new AppError('INVALID');
  if(ordinal>=(root?.count??0))return null;
  while(root){const node=await this.node(root);if(node.entries)return node.entries[ordinal]??null;let next=null;for(const child of node.children){if(ordinal<child.count){next=child;break;}ordinal-=child.count;}root=next;}return null;
 }
 async *nodes(root,{signal}={}){
  const pending=root?[root]:[];while(pending.length){signal?.throwIfAborted();const ref=pending.pop(),node=await this.node(ref);yield {ref,node};if(node.children)for(let i=node.children.length-1;i>=0;i--)pending.push(node.children[i]);}
 }
 async *entries({root}){for await(const {node} of this.nodes(root))if(node.entries)yield* node.entries;}
 // Merge two authenticated trees by key, skipping shared immutable branches.
 // Frontiers contain only one path and its siblings, even across tree splits.
 async *differences(before,after,{signal}={}){
  if(!validTableRef(before)||!validTableRef(after))fail();
  const left=before?[{ref:before}]:[],right=after?[{ref:after}]:[];
  const first=item=>item.ref?.first??item.entry.id,last=item=>item.ref?.last??item.entry.id;
  const expand=async stack=>{const {ref}=stack.pop(),node=await this.node(ref),children=node.children?.map(ref=>({ref}))??node.entries.map(entry=>({entry}));for(let i=children.length-1;i>=0;i--)stack.push(children[i]);};
  while(left.length||right.length){
   signal?.throwIfAborted();const a=left.at(-1),b=right.at(-1);
   if(a?.ref&&b?.ref&&a.ref.hash===b.ref.hash){
    if(['count','first','last','height'].some(key=>a.ref[key]!==b.ref[key]))fail();left.pop();right.pop();continue;
   }
   if(!b||a&&last(a)<first(b)){
    if(a.ref){await expand(left);continue;}left.pop();yield {id:a.entry.id,before:a.entry,after:null};continue;
   }
   if(!a||last(b)<first(a)){
    if(b.ref){await expand(right);continue;}right.pop();yield {id:b.entry.id,before:null,after:b.entry};continue;
   }
   if(a.ref||b.ref){
    const ah=a.ref?.height??0,bh=b.ref?.height??0;
    if(ah>=bh)await expand(left);if(bh>=ah)await expand(right);continue;
   }
   left.pop();right.pop();if(a.entry.id!==b.entry.id)fail();
   if(a.entry.revision!==b.entry.revision)yield {id:a.entry.id,before:a.entry,after:b.entry};
  }
 }
}
