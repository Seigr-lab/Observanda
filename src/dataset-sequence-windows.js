// Pages are immutable for the lifetime of a pinned schema or cell vector.
// Keep a byte budget as well as an entry budget for very wide declarations.
export function datasetSequenceWindows(materials){
 const cache=new Map(),maxBytes=1024*1024;
 let bytes=0;
 return async(index,offset,limit)=>{
  const key=[index.kind,index.root.key,index.root.hash,index.root.height,index.count,index.chunkSize,offset,limit].join(':');
  const hit=cache.get(key);
  if(hit){cache.delete(key);cache.set(key,hit);return hit.items;}
  const {items}=await materials.sequences.page(index,{offset,limit});
  const size=Buffer.byteLength(JSON.stringify(items));
  if(size<=maxBytes){
   while(cache.size>=256||bytes+size>maxBytes){
    const first=cache.keys().next().value;
    bytes-=cache.get(first).size;cache.delete(first);
   }
   cache.set(key,{items,size});bytes+=size;
  }
  return items;
 };
}
