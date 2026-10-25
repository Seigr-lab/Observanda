import os from 'node:os';

// Elapsed budgets are observed under the machine's current shared load. These
// diagnostics report that load; they neither reserve CPUs nor assume idleness.
export function sampleWorkloadCpu(){
 const read=()=>os.cpus().map(({times})=>({idle:times.idle,total:Object.values(times).reduce((sum,value)=>sum+value,0)}));
 const started=performance.now(),usage=process.cpuUsage();let prior=read(),busy=0,total=0,peakCore=0,samples=0,result;
 const sample=()=>{
  const current=read();
  if(current.length===prior.length){
   let elapsed=0,active=0;
   for(let i=0;i<current.length;i++){const delta=current[i].total-prior[i].total,idle=current[i].idle-prior[i].idle;if(delta<=0||idle<0||idle>delta)continue;elapsed+=delta;active+=delta-idle;peakCore=Math.max(peakCore,(delta-idle)/delta);}
   if(elapsed){total+=elapsed;busy+=active;samples++;}
  }
  prior=current;
 };
 const timer=setInterval(sample,1000);timer.unref();
 return {stop(){
  if(result)return result;clearInterval(timer);sample();const cpu=process.cpuUsage(usage);
  return result={elapsedMs:Math.round(performance.now()-started),testProcessCpuMs:Math.round((cpu.user+cpu.system)/1000),logicalCpus:prior.length,systemBusyPercent:total?Math.round(10000*busy/total)/100:null,peakCoreBusyPercent:samples?Math.round(10000*peakCore)/100:null,samples};
 }};
}
