// Compare a verified retained search root with the next snapshot. Only changed
// records contribute new expected terms; every actual changed index key must
// have a matching independently derived value. Scratch state is encrypted and
// discarded with this audit, never a durable trust receipt.
import {RecordSearchIndex} from './record-search-index.js';
import {SnapshotIndex} from './snapshot-index.js';
import {withScratch} from './scratch-work.js';
import {SEARCH_BLOCK_SIZE,bitmapHex,positionKey,wordKey} from './record-search-terms.js';
import {withChangedRecordTerms} from './record-search-stream.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {verifyIndexChanges} from './index-change-verification.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
export async function verifySearchChange(store,before,after){
 if(!before?.indexVersion||!after.indexVersion||!RecordSearchIndex.valid(before.searchIndex)||!RecordSearchIndex.valid(after.searchIndex)||before.searchIndex.version!==after.searchIndex.version)return false;
 const members=new SnapshotIndex(store,{cacheSize:4096}),search=new RecordSearchIndex(store,{cacheSize:4096});
 await withScratch(async work=>{
  const pending=new Map();
  const flush=async()=>{
   const entries=[...pending];
   for(let offset=0;offset<entries.length;offset+=32){
    const batch=entries.slice(offset,offset+32),prior=await work.getMany(batch.map(([id])=>id));
    const values=batch.map(([id,value])=>{
     const previous=prior.get(id);
     if(previous){
      if(value.kind!==previous.kind)fail();
      if(value.kind==='word'){value.remove=bitmapHex(BigInt('0x'+value.remove)|BigInt('0x'+previous.remove));value.add=bitmapHex(BigInt('0x'+value.add)|BigInt('0x'+previous.add));}
      else{if(value.before&&previous.before||value.after&&previous.after)fail();value.before??=previous.before;value.after??=previous.after;}
     }
     return [id,value];
    });
    await work.putMany(values);
   }
   pending.clear();
  };
  async function position(row,side){
   const id=positionKey(row.position),value=pending.get(id)??{id,kind:'position',before:null,after:null};
   if(value[side])fail();value[side]=hash(row);pending.set(id,value);if(pending.size===2048)await flush();
  }
  async function words(row,terms,side){
   const bit=1n<<BigInt(row.position%SEARCH_BLOCK_SIZE);
   for await(const term of terms){
    const id=wordKey(row,term),value=pending.get(id)??{id,kind:'word',remove:bitmapHex(0n),add:bitmapHex(0n)};
    value[side]=bitmapHex(BigInt('0x'+value[side])|bit);pending.set(id,value);if(pending.size===2048)await flush();
   }
  }
  await withScratch(async ordered=>{
   for await(const delta of members.differences(before.membership,after.membership,'record:')){
    const a=await members.member(delta.before),b=await members.member(delta.after);
    if(a&&delta.id!=='record:'+a.id||b&&delta.id!=='record:'+b.id)fail();
    if(a)await position(a,'before');if(b)await position(b,'after');
    const same=a&&b&&a.position===b.position&&a.notebookId!==undefined&&a.notebookId===b.notebookId;
    if(same&&a.queryRevision!==undefined&&a.queryRevision===b.queryRevision)continue;
    for(const [side,row,other] of [['before',a,b],['after',b,a]])if(row){
     // UUID order interleaves bitmap blocks and repeatedly flushes their words.
     // Keep the grouping encrypted and disk-backed; retain only one query pair and
     // the bounded word accumulator while deriving the independent expectation.
     const group=side+':'+(row.notebookId??'')+':'+Math.floor(row.position/SEARCH_BLOCK_SIZE);
     await ordered.putGrouped(group,row.id,{side,row,other:same?other:null});
    }
   }
   await flush();
   for await(const {side,row,other} of ordered.items()){
    const source=side==='before'?before:after,opposite=side==='before'?after:before;
    await withChangedRecordTerms(store,row,source.metadata,other,opposite.metadata,after.searchIndex.version,
     (terms,notebookId)=>words({...row,notebookId},terms,side==='before'?'remove':'add'),{audit:true});
   }
  });
  await flush();
  await verifyIndexChanges(search,before.searchIndex,after.searchIndex,work,(item,prior,next)=>{
   if(item.kind==='position'){if(prior!==item.before||next!==item.after)fail();}
   else{
    const bits=BigInt('0x'+(prior??'0')),remove=BigInt('0x'+item.remove),add=BigInt('0x'+item.add);
    if((bits&remove)!==remove)fail();const expected=bits&~remove|add;
    if(next!==(expected?bitmapHex(expected):null))fail();
   }
  });
 });
 return true;
}
