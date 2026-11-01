import {performance} from 'node:perf_hooks';
import {AppError} from '../errors.js';
import {liveJSON} from './live-protocol.js';

// An incomplete, unauthenticated body cannot reserve signed-operation slots.
// Address keys live only for active bodies; completed traffic retains no map.
export class LiveIngress{
 constructor(){this.preAuth=new Map();this.principals=new Map();this.reading=0;this.active=0;}
 acquire(principal,address){
  const authenticated=principal!==null,map=authenticated?this.principals:this.preAuth,key=authenticated?principal:address,total=authenticated?'active':'reading',limit=authenticated?16:8,perKey=authenticated?4:2;
  if(this[total]>=limit||(map.get(key)??0)>=perKey)throw new AppError('ACCESS_WAIT');
  this[total]++;map.set(key,(map.get(key)??0)+1);let released=false;
  return ()=>{if(released)return;released=true;this[total]--;const count=map.get(key)-1;if(count)map.set(key,count);else map.delete(key);};
 }
}

export async function readLiveBody(request,{authenticated=false,timeout=authenticated?30000:2000,grace=500,minimumBytesPerSecond=authenticated?8192:1024}={}){
 let bytes=0;const started=performance.now(),fail=()=>request.destroy(new AppError('ACCESS_WAIT'));
 const deadline=setTimeout(fail,timeout),rate=setInterval(()=>{if(bytes<(performance.now()-started-grace)*minimumBytesPerSecond/1000)fail();},250);deadline.unref();rate.unref();
 async function* chunks(){for await(const chunk of request){bytes+=chunk.length;yield chunk;}}
 try{return await liveJSON(chunks());}finally{clearTimeout(deadline);clearInterval(rate);}
}
