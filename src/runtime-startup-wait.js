// A request can leave a shared startup without cancelling its process owner.
// Observe both outcomes even after cancellation so late failures are handled.
export async function waitRuntimeStartup(startup,signal){
 if(!signal)return startup;
 let abort;
 const cancelled=new Promise((resolve,reject)=>{
  abort=()=>reject(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
 });
 try{const result=await Promise.race([cancelled,startup]);signal.throwIfAborted();return result;}
 finally{signal.removeEventListener('abort',abort);}
}
