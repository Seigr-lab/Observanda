// Closing the owner window must not hide a still-running operation. The
// service supplies status independently of the renderer and workspace writer.
export function closeGuard({status,ask,close,waiting,failed,unavailable}){
 let checking=false,scheduled=false,allowed=false,disposed=false,timer=null,failure=0;
 function cancel(){scheduled=false;clearTimeout(timer);waiting(false);}
 function finish(){cancel();allowed=true;try{close();}finally{allowed=false;}}
 async function poll(){
  if(disposed||!scheduled)return;
  try{
   const current=await status();if(disposed||!scheduled)return;
   if(current.failure>failure){cancel();await failed();return;}
   if(!current.busy){finish();return;}
  }catch{cancel();if(!disposed)await unavailable();return;}
  if(scheduled)timer=setTimeout(poll,500);
 }
 async function request(){
  if(checking||disposed)return;checking=true;
  try{
   const current=await status();if(disposed)return;
   if(!current.busy){finish();return;}
   cancel();
   if(await ask()){
    if(disposed)return;scheduled=true;failure=current.failure;waiting(true);timer=setTimeout(poll,500);
   }
  }catch{if(!disposed)await unavailable();}
  finally{checking=false;}
 }
 return {get allowed(){return allowed;},request,cancel,dispose(){disposed=true;cancel();}};
}
