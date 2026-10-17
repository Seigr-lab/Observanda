import {streamOperation} from './operation-stream.js';
import {withOperationProgress} from './operation-progress.js';

// Authorization and complete body admission belong to the route. A negotiated
// stream keeps long operations observable without changing JSON-only clients.
// The command owner decides whether disconnection can safely cancel its work.
export async function operationResponse(req,res,operation,json,{continueAfterDisconnect=false,completionError=()=>null}={}){
 // Admitted durable commands own their lifetime; disconnecting only detaches
 // the observer. Their writer checks still enforce shutdown and access changes.
 if(continueAfterDisconnect)req.continueAfterDisconnect=true;
 const socket=req.socket,timeout=socket.timeout;
 res.setTimeout(0);
 const activity=req.operationActivity?.();
 const execute=async(options={})=>{
  const onProgress=value=>{activity?.progress(value);options.onProgress?.(value);};
  try{const result=await withOperationProgress(onProgress,()=>operation({...options,...(continueAfterDisconnect?{signal:undefined}:{}),onProgress}));activity?.finish(completionError(result));return result;}
  catch(error){if(error.operationNotStarted===true)activity?.remove();else activity?.finish(error);throw error;}
 };
 try{
  if(req.headers.accept==='application/x-ndjson')return await streamOperation(res,execute);
  return json(await execute());
 }finally{if(!socket.destroyed)socket.setTimeout(timeout??60000);}
}
