import {AppError} from './errors.js';
// Adapt an awaited producer without buffering its result collection. Returning
// or failing the iterator cancels and drains the producer before its read scope
// can close. Callers must await every emit, including connected-source reads.
export function queryCallbackSource(produce,{signal,check=()=>{}}={}){
 let metadata,complete=false;
 const rows=(async function*(){
  const controller=new AbortController(),activeSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let available=Promise.withResolvers(),pending,ack,done=false,failure;
  const abort=()=>{ack?.reject(activeSignal.reason);available.resolve();};activeSignal.addEventListener('abort',abort,{once:true});
  const emit=async row=>{
   check();activeSignal.throwIfAborted();if(ack)throw new AppError('INVALID');
   ack=Promise.withResolvers();const current=ack;pending={row};available.resolve();
   try{await current.promise;check();activeSignal.throwIfAborted();}finally{if(ack===current)ack=null;}
  };
  const producer=Promise.resolve().then(()=>{check();activeSignal.throwIfAborted();return produce(emit,activeSignal);}).then(value=>{metadata=value;},error=>{failure=error;}).finally(()=>{done=true;available.resolve();});
  try{
   for(;;){
    check();activeSignal.throwIfAborted();
    if(ack&&pending){const value=pending.row,current=ack;pending=null;try{yield value;}finally{current.resolve();}continue;}
    if(done){if(failure)throw failure;complete=true;return;}
    await available.promise;available=Promise.withResolvers();
   }
  }finally{
   if(!done)controller.abort(new AppError('DATABASE_CANCELLED'));
   await producer;activeSignal.removeEventListener('abort',abort);
  }
 })();
 return {rows,finish(){if(!complete)throw new AppError('INVALID');return metadata;}};
}
