// Add local download authorization to browser previews without modifying any
// saved/publication file. Retain at most the 15-byte doctype between chunks.
export function sessionPreview(response){
 if(response.status!==200||!response.headers.get('content-type')?.startsWith('text/html')||!response.body)return response;
 const declaration=new TextEncoder().encode('<!doctype html>'),script=new TextEncoder().encode('<script type="module" src="/session-download.js" data-observanda-session></script>');let prefix=new Uint8Array(0),started=false;
 const body=response.body.pipeThrough(new TransformStream({
  transform(chunk,controller){
   if(started){controller.enqueue(chunk);return;}
   const needed=declaration.length-prefix.length,take=Math.min(needed,chunk.length),next=new Uint8Array(prefix.length+take);next.set(prefix);next.set(chunk.subarray(0,take),prefix.length);prefix=next;
   if(prefix.length<declaration.length)return;
   controller.enqueue(prefix);if(prefix.every((byte,index)=>(byte>=65&&byte<=90?byte+32:byte)===declaration[index]))controller.enqueue(script);
   if(take<chunk.length)controller.enqueue(chunk.subarray(take));prefix=null;started=true;
  },flush(controller){if(!started&&prefix.length)controller.enqueue(prefix);}
 }));
 const headers=new Headers(response.headers);headers.delete('Content-Length');headers.delete('ETag');headers.set('Cache-Control','no-store');return new Response(body,{status:response.status,statusText:response.statusText,headers});
}
