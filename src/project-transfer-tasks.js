// In-process liveness is an observation. Durable receipts own recovery after
// restart; an interrupted command is never reported as still running.
const running=new Map();
export const projectTransferRunning=file=>(running.get(file)??0)>0;
export async function trackProjectTransfer(file,operation){
 running.set(file,(running.get(file)??0)+1);
 try{return await operation();}finally{const count=running.get(file)-1;if(count)running.set(file,count);else running.delete(file);}
}
