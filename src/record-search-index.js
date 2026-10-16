import {retiredSearchNodes} from './project-retired-search.js';
// Private substring search over immutable, authenticated bitmap postings.
// Reuses ObjectIndex: keys, grams and 256-record bitmaps are encrypted together.
// A snapshot pins the root; a new record revision changes only affected paths.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {SnapshotIndex} from './snapshot-index.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {buildIndex} from './index-builder.js';
import {recordOrder} from './record-order.js';
import {SEARCH_BLOCK_SIZE as blockSize,bitmapHex as hex,positionKey,termPrefix as prefix,grams,referenceTerm,wordKey} from './record-search-terms.js';
import {recordTerms,withRecordTerms,withChangedRecordTerms} from './record-search-stream.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
const zero='0'.repeat(64);
function searchGrams(text){
 const all=[...grams(text,Math.min(3,text.length))];
 // Bound planning and intersections; the shared matcher verifies the complete
 // phrase after candidate selection. Extra candidates cannot change results.
 if(all.length<=8)return all;
 return [...new Set(Array.from({length:8},(_,i)=>all[Math.floor(i*(all.length-1)/7)]))];
}
export class RecordSearchIndex extends ObjectIndex{
 constructor(store,{cacheSize=128}={}){super(store,{namespace:'record-search-index:',immutable:true,cacheSize});}
 async readMissingNode(ref){
  const retained=await retiredSearchNodes(this.store,ref);for(const item of retained)this.cacheNode(item.ref,item.node);
  return retained[0]?.node??null;
 }
 static valid(value){return [1,2].includes(value?.version)&&Object.keys(value).sort().join()==='root,version'&&validIndexRef(value.root);}
 async positionRevision(value,position){
  if(!RecordSearchIndex.valid(value)||!Number.isSafeInteger(position)||position<0)fail();
  return (await this.find({root:value.root},positionKey(position)))?.revision??null;
 }
 async build(snapshot){
  const self=this;
  async function* entries(){
   // Keep a bounded vocabulary across records before updating the tree. A
   // small per-record buffer repeatedly rewrites common bitmap words.
   const batch=new Map(),wordLimit=32768;
   const drain=function*(){for(const [id,revision] of [...batch].sort(([a],[b])=>a<b?-1:1))yield {id,revision};batch.clear();};
   for await(const row of self.store.members(snapshot)){
    const position=positionKey(row.position);if(batch.has(position))fail();batch.set(position,hash(row));
    if(batch.size===wordLimit)yield* drain();
    const bit=1n<<BigInt(row.position%blockSize);
    for await(const {term,notebookId} of recordTerms(self.store,row,snapshot.metadata,2)){
     const id=wordKey({...row,notebookId},term);
     batch.set(id,hex(BigInt('0x'+(batch.get(id)??zero))|bit));if(batch.size===wordLimit)yield* drain();
    }
   }
   yield* drain();
  }
  const root=await buildIndex(this.store,this,entries(),(before,after,id)=>{
   if(id.startsWith('position:'))fail();
   return hex(BigInt('0x'+before)|BigInt('0x'+after));
  });return {version:2,root};
 }
 async replace(value,before,after,metadata,{beforeMetadata=metadata}={}){
  if(!RecordSearchIndex.valid(value))fail();
  const old=new Map(before.map(row=>[row.id,row])),next=new Map(after.map(row=>[row.id,row]));
  // Unchanged query text needs no re-indexing, even if non-search record content
  // changes. The position still points to the exact new member revision.
  const changed=[...new Set([...old.keys(),...next.keys()])].filter(id=>{
   const a=old.get(id),b=next.get(id);return !a||!b||a.position!==b.position||a.notebookId!==b.notebookId||a.queryRevision!==b.queryRevision;
  });
  // Remove and add in separate passes so swaps retain the correct bit at
  // every position. Keep one pair of query documents and 2,048 bitset words,
  // rather than retaining the changed corpus's searchable text in two maps.
  let root=value.root;
  for(const action of ['remove','add']){
   const side=action==='remove'?old:next;
   // Visit each lab-book bitmap block together. UUID order interleaves blocks
   // and repeatedly evicts the same words from the bounded accumulator.
   const ordered=changed.filter(id=>side.has(id)).sort((a,b)=>{
    const x=side.get(a),y=side.get(b);return x.notebookId<y.notebookId?-1:x.notebookId>y.notebookId?1:x.position-y.position;
   });
   const words=new Map();
   const flush=async()=>{
    for(const [key,mask] of words){
     const found=await this.find({root},key),prior=BigInt('0x'+(found?.revision??zero));
     if(action==='remove'&&(prior&mask)!==mask)fail();
     const bits=action==='remove'?prior&~mask:prior|mask;
     root=await this.change(root,key,bits?hex(bits):null);
    }
    words.clear();await this.flush(root);
   };
   for(const id of ordered){
    const a=old.get(id),b=next.get(id),row=action==='remove'?a:b;
    if(!row)continue;
    const same=a&&b&&a.position===b.position&&a.notebookId===b.notebookId;
    const context=action==='remove'?beforeMetadata:metadata;
    await withChangedRecordTerms(this.store,row,context,same?(action==='remove'?b:a):null,action==='remove'?metadata:beforeMetadata,value.version,async(terms,notebookId)=>{
     for await(const gram of terms){
      const key=wordKey({...row,notebookId},gram),bit=1n<<BigInt(row.position%blockSize);
      words.set(key,(words.get(key)??0n)|bit);if(words.size===2048)await flush();
     }
    });
   }
   await flush();
  }
  const positions=new Map();
  for(const row of before)positions.set(positionKey(row.position),null);
  for(const row of after)positions.set(positionKey(row.position),hash(row));
  for(const [key,revision] of positions){root=await this.change(root,key,revision);if(this.pendingBytes>=4*1024*1024)await this.flush(root);}
  await this.flush(root);return {version:value.version,root};
 }

 async rank(root,key,{signal}={}){
  let rank=0,lower=null,upper=null;
  while(root){
   signal?.throwIfAborted();const node=await this.node(root,lower,upper);
   if(node.id<key){rank+=1+(node.left?.count??0);lower=node.id;root=node.right;}
   else{upper=node.id;root=node.left;}
  }
  return rank;
 }
 async *candidates(value,notebookIds,needle,{signal,relatedTo=null,after=null,backward=false}={}){
  if(!RecordSearchIndex.valid(value)||!needle&&!relatedTo||relatedTo&&value.version!==2)fail();
  if(after!==null&&(!Number.isSafeInteger(after)||after<0)||typeof backward!=='boolean')throw new AppError('INVALID');
  const root=value.root,terms=[...(needle?searchGrams(needle):[]),...(relatedTo?[referenceTerm(relatedTo)]:[])],members=new SnapshotIndex(this.store);
  for(const notebookId of notebookIds){
   signal?.throwIfAborted();
   const plans=[];
   for(const term of terms){
    const start=prefix(notebookId,term),count=await this.rank(root,start+'\uffff',{signal})-await this.rank(root,start,{signal});
    plans.push({start,count});if(!count)break;
   }
   if(plans.some(plan=>!plan.count))continue;
   plans.sort((a,b)=>a.count-b.count);
   const [first,...rest]=plans;
   // Seek to the bitmap containing the boundary. Earlier postings are never
   // replayed when a reader continues near the end of a large reference set.
   const boundary=after===null?null:Math.floor(after/blockSize),head={root};
   const words=async function*(index){
    if(!backward){yield* index.entries(head,first.start,boundary===null||boundary===0?null:first.start+String(boundary-1).padStart(16,'0'));return;}
    let ordinal=await index.rank(root,boundary===null?first.start+'\uffff':first.start+String(boundary).padStart(16,'0')+'\0',{signal});
    while(ordinal>0){signal?.throwIfAborted();const word=await index.entryAt(head,--ordinal);if(!word?.id.startsWith(first.start))break;yield word;}
   };
   for await(const word of words(this)){
    signal?.throwIfAborted();const suffix=word.id.slice(first.start.length),block=Number(suffix);
    if(!/^[0-9]{16}$/.test(suffix)||!Number.isSafeInteger(block)||!Number.isSafeInteger(block*blockSize+blockSize-1)||word.revision===zero)fail();
    let bits=BigInt('0x'+word.revision);
    for(const plan of rest){
     signal?.throwIfAborted();const other=await this.find({root},plan.start+suffix);
     if(other?.revision===zero)fail();
     bits&=BigInt('0x'+(other?.revision??zero));if(!bits)break;
    }
    for(let step=0;bits&&step<blockSize;step++){
     const offset=backward?blockSize-1-step:step,bit=1n<<BigInt(offset);if(!(bits&bit))continue;bits&=~bit;
     signal?.throwIfAborted();const position=block*blockSize+offset;
     if(after!==null&&(backward?position>=after:position<=after))continue;
     const row=await members.member(await this.find({root},positionKey(position)));
     if(!row||row.position!==position||row.notebookId!==undefined&&row.notebookId!==notebookId)fail();
     yield row;
    }
   }
  }
 }
 async verify(snapshot){
  if(!RecordSearchIndex.valid(snapshot.searchIndex))fail();
  const head={root:snapshot.searchIndex.root},expected=new Map();let expectedBits=0n,expectedPositions=0;
  const checkBatch=async()=>{
   for(const [key,bits] of [...expected].sort(([a],[b])=>a<b?-1:1)){
    const word=await this.find(head,key);if(!word||(BigInt('0x'+word.revision)&bits)!==bits)fail();
   }
   expected.clear();
  };
  for await(const row of recordOrder(this.store,snapshot,{cacheSize:4096})){
   if((await this.find(head,positionKey(row.position)))?.revision!==hash(row))fail();
   expectedPositions++;const bit=1n<<BigInt(row.position%blockSize);
   await withRecordTerms(this.store,row,snapshot.metadata,snapshot.searchIndex.version,async bag=>{
    for await(const gram of bag.items()){
     const key=wordKey({...row,notebookId:bag.notebookId},gram);
     expected.set(key,(expected.get(key)??0n)|bit);expectedBits++;if(expected.size===2048)await checkBatch();
    }
   });
  }
  await checkBatch();
  // Every expected (word, position) pair was checked above. Equal cardinality
  // excludes extra bits/words as well, without retaining a corpus-sized map.
  let actualBits=0n,actualPositions=0;
  for await(const entry of this.entries(head)){
   if(/^position:[0-9]{16}$/.test(entry.id)){actualPositions++;continue;}
   const word=/^book:[a-f0-9-]{36}:gram:(?:[a-f0-9]{4}){1,3}:[0-9]{16}$/.test(entry.id);
   const reference=snapshot.searchIndex.version===2&&/^book:[a-f0-9-]{36}:gram:ref-[a-f0-9-]{36}-[a-f0-9-]{36}:[0-9]{16}$/.test(entry.id);
   if(!(word||reference)||entry.revision===zero)fail();
   let bits=BigInt('0x'+entry.revision);while(bits){bits&=bits-1n;actualBits++;}
  }
  if(expectedBits!==actualBits||expectedPositions!==actualPositions||expectedPositions!==snapshot.count)fail();
 }
}
