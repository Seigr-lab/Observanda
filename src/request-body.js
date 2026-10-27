import {AppError} from './errors.js';

// Receipt deadlines apply only while reading JSON, before a command can use
// it. They never time out a commit. Streaming original uploads use their own
// resumable intake protocol and do not pass through this JSON reader.
export function jsonBody(req,{limit,retain=()=>{},admit=()=>{},idleMs=15000,totalMs=120000}={}){
 if(req.headers['content-type']!=='application/json')throw new AppError('INVALID');
 const declared=req.headers['content-length']===undefined?null:Number(req.headers['content-length']);
 if(declared!==null&&(!Number.isSafeInteger(declared)||declared<0))throw new AppError('INVALID');
 if(declared!==null){admit(declared);if(declared>limit)throw new AppError('LIMIT');retain(declared);}
 return new Promise((resolve,reject)=>{
  const chunks=[];let size=0,idle,total,finished=false;
  const cleanup=()=>{clearTimeout(idle);clearTimeout(total);req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',aborted);};
  const fail=value=>{if(finished)return;finished=true;req.pause();cleanup();chunks.length=0;reject(value);};
  const reset=()=>{clearTimeout(idle);idle=setTimeout(()=>fail(new AppError('REQUEST_TIMEOUT')),idleMs);};
  const error=value=>fail(value),aborted=()=>fail(new AppError('WRITE_CANCELLED'));
  const data=chunk=>{
   try{size+=chunk.length;admit(size);if(size>limit)throw new AppError('LIMIT');retain(Math.max(declared??0,size));chunks.push(chunk);reset();}catch(value){fail(value);}
  };
  const end=()=>{
   if(finished)return;finished=true;cleanup();
   try{if(declared!==null&&declared!==size)throw new AppError('INVALID');const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('INVALID');resolve(value);}catch{reject(new AppError('INVALID'));}finally{chunks.length=0;}
  };
  req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',aborted);total=setTimeout(()=>fail(new AppError('REQUEST_TIMEOUT')),totalMs);reset();
  if(req.aborted)aborted();else req.resume();
 });
}
