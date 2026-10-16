// Progress is an observation, never a completion receipt. Slow clients retain
// only the latest observation; commands choose whether to honor disconnection.
import {safeError} from './errors.js';
export async function streamOperation(res,operation){
 const controller=new AbortController(),startedAt=Date.now();
 const disconnected=()=>{if(!res.writableEnded)controller.abort();};
 res.once('close',disconnected);res.once('error',disconnected);
 let progress={stage:'preparing',advancedAt:startedAt},pending=false;
 const writable=()=>!res.destroyed&&!controller.signal.aborted;
 const flush=()=>{
  if(!pending||!writable()||res.writableNeedDrain)return;
  pending=false;const now=Date.now();res.write(JSON.stringify({progress:{...progress,observedAt:now,elapsedMs:now-startedAt}})+'\n');
 };
 const sendProgress=()=>{pending=true;flush();};
 res.on('drain',flush);
 const finish=async event=>{
  pending=false;
  if(writable()&&res.writableNeedDrain)await new Promise(resolve=>{
   const done=()=>{res.off('drain',done);res.off('close',done);res.off('error',done);resolve();};
   res.once('drain',done);res.once('close',done);res.once('error',done);
  });
  if(writable())res.write(JSON.stringify(event)+'\n');
 };
 res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});sendProgress();
 const heartbeat=setInterval(sendProgress,5000);heartbeat.unref();
 try{
  const result=await operation({signal:controller.signal,onProgress:value=>{progress={advancedAt:Date.now(),...value};sendProgress();}});
  clearInterval(heartbeat);await finish({result});
 }catch(error){clearInterval(heartbeat);await finish({error:safeError(error)});}
 finally{clearInterval(heartbeat);res.off('drain',flush);res.off('close',disconnected);res.off('error',disconnected);res.end();}
}
