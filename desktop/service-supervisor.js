const phases=new Set(['startup','http-drain','database-stop','stopped']);

// A watchdog bounds how long shutdown can be silent, not how long a database
// may safely flush. It never terminates a process or declares a pending write
// unsuccessful just because the IPC channel is slow.
export class ServiceSupervisor{
 constructor({query,onState=()=>{},onWaiting=()=>{},intervalMs=5000,noticeMs=15000,probeMs=5000}={}){
  if(typeof query!=='function'||![intervalMs,noticeMs,probeMs].every(value=>Number.isSafeInteger(value)&&value>0))throw new TypeError('Invalid service supervisor');
  this.query=query;this.onState=onState;this.onWaiting=onWaiting;this.intervalMs=intervalMs;this.noticeMs=noticeMs;this.probeMs=probeMs;this.state='starting';this.phase='startup';this.stopping=false;this.stopPromise=null;this.timer=null;
 }
 change(state){this.state=state;try{this.onState({state,phase:this.phase});}catch{}}
 ready(){this.wasReady=true;if(!this.stopping&&this.state!=='stopped')this.change('ready');}
 progress(phase){if(phases.has(phase)){this.phase=phase;this.change(this.state);}}
 exited(){const unexpected=!this.stopping;clearInterval(this.timer);this.change('stopped');return unexpected;}
 monitor(){
  if(this.timer||this.stopping||this.state==='stopped')return;let checking=false;
  this.timer=setInterval(()=>{
   if(checking)return;checking=true;
   void this.probe().then(responding=>{if(!this.stopping&&this.state!=='stopped')this.change(responding?(this.wasReady?'ready':'starting'):'degraded');}).finally(()=>{checking=false;});
  },this.intervalMs);this.timer.unref?.();
 }
 async probe(){
  let timer;try{
   const result=await Promise.race([Promise.resolve().then(()=>this.query()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Service status unavailable')),this.probeMs);timer.unref?.();})]);
   this.progress(result.phase);return true;
  }catch{return false;}finally{clearTimeout(timer);}
 }
 stop(sendStop,exited){
  if(this.stopPromise)return this.stopPromise;
  clearInterval(this.timer);
  this.stopping=true;this.change('stopping');const started=Date.now();let complete=false,checking=false,notified=false;
  const observe=async()=>{
   if(complete||checking)return;checking=true;
   try{
    const responding=await this.probe();if(complete)return;
    this.change(responding?'stopping':'degraded');
    if(!notified&&(!responding||Date.now()-started>=this.noticeMs)){
     notified=true;await this.onWaiting({state:this.state,phase:this.phase,responding,elapsedMs:Date.now()-started});
    }
   }finally{checking=false;}
  };
  this.timer=setInterval(()=>{void observe().catch(()=>{});},this.intervalMs);this.timer.unref?.();
  this.stopPromise=(async()=>{
   try{try{await sendStop();}catch{this.change('degraded');}await exited;}
   finally{complete=true;clearInterval(this.timer);this.change('stopped');}
  })();return this.stopPromise;
 }
}
