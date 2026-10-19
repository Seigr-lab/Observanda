import {createHash} from 'node:crypto';

// Generated streams keep owned chunks only. A nested producer never waits for
// buffer space: it falls back to the original stream, replaying its exact prefix.
export class PublicationOutputBuffer{
 constructor(){this.bytes=0;}
 async prepare(source,{signal,validate}={}){
  const owner=this,iterator=source[Symbol.asyncIterator](),chunks=[],hash=createHash('sha256');let size=0,held=0,closed=false,disposed=false;
  const release=()=>{owner.bytes-=held;held=0;chunks.length=0;};
  const dispose=async()=>{if(disposed)return;disposed=true;release();if(!closed){closed=true;await iterator.return?.();}};
  async function* replay(first){
   try{
    for(const bytes of chunks){signal?.throwIfAborted();yield bytes;}
    if(first!==undefined){signal?.throwIfAborted();yield Buffer.from(first);}
    while(!closed){signal?.throwIfAborted();const next=await iterator.next();signal?.throwIfAborted();if(next.done){closed=true;break;}yield Buffer.from(next.value);}
   }finally{await dispose();}
  }
  const fallback=first=>({buffered:false,source:replay(first),dispose});
  try{
   for(;;){
    signal?.throwIfAborted();if(owner.bytes>=1024*1024)return fallback();
    const next=await iterator.next();signal?.throwIfAborted();
    if(next.done){closed=true;if(validate)await validate(Buffer.concat(chunks,size));signal?.throwIfAborted();return {buffered:true,size,sha256:hash.digest('hex'),source:replay(),dispose};}
    const count=Buffer.byteLength(next.value);
    if(size+count>256*1024||owner.bytes+count>1024*1024)return fallback(next.value);
    const bytes=Buffer.from(next.value);chunks.push(bytes);size+=bytes.length;held+=bytes.length;owner.bytes+=bytes.length;hash.update(bytes);
   }
  }catch(error){try{await dispose();}catch{}throw error;}
 }
}
