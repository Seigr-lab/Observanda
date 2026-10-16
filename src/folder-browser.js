import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {AppError} from './errors.js';

const worker=fileURLToPath(new URL('./folder-browser-worker.js',import.meta.url));
// Killing this read-only child abandons blocked mount calls without leaving
// jobs in the main process's filesystem thread pool. No shell or path argv.
export function readFolder(input,{signal,timeout=10000,placesTimeout=2500,workerFile=worker,onSpawn}={}) {
  if(signal?.aborted)return Promise.reject(new AppError('FOLDER_CANCELLED'));
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[workerFile],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,UV_THREADPOOL_SIZE:'4'}});
    let timer,placeTimer,buffer='',bytes=0,listing,done=false,failure,partial=false;const places=[];
    const stop=error=>{failure??=error;child.kill('SIGKILL');};
    const abort=()=>stop(new AppError('FOLDER_CANCELLED'));
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{
      if(listing&&input.discover&&!done){partial=true;child.kill('SIGKILL');}
      else stop(new AppError('FOLDER_TIMEOUT'));
    },timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      bytes+=Buffer.byteLength(chunk);if(bytes>4*1024*1024){stop(new AppError('IO'));return;}
      buffer+=chunk;let end;
      while((end=buffer.indexOf('\n'))!==-1){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try{
          const item=JSON.parse(line);
          if(item.error){stop(item.error==='UNSAFE'?new AppError('UNSAFE'):new AppError('FOLDER_UNAVAILABLE'));break;}
          if(item.listing){
            if(listing||typeof item.listing.folder!=='string'||!Array.isArray(item.listing.folders))throw new Error();
            listing=item.listing;
            if(input.discover)placeTimer=setTimeout(()=>{partial=true;child.kill('SIGKILL');},placesTimeout);
          }else if(item.place){
            if(places.length>=256||typeof item.place.path!=='string'||typeof item.place.name!=='string'||!['home','folder','drive'].includes(item.place.kind))throw new Error();
            places.push(item.place);
          }else if(item.done===true){done=true;clearTimeout(placeTimer);}
          else throw new Error();
        }catch{stop(new AppError('IO'));break;}
      }
    });
    child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)stop(new AppError('IO'));});
    child.stdin.on('error',()=>{}); // The child may exit before consuming input.
    child.once('error',()=>{failure??=new AppError('IO');});
    child.once('close',code=>{
      clearTimeout(timer);clearTimeout(placeTimer);signal?.removeEventListener('abort',abort);
      if(signal?.aborted)failure=new AppError('FOLDER_CANCELLED');
      if(failure)return reject(failure);
      if(!listing||!partial&&(code!==0||!done||buffer))return reject(new AppError('IO'));
      resolve({listing,places,placesIncomplete:partial});
    });
    child.stdin.end(JSON.stringify(input));
    onSpawn?.(child);
  });
}

export function createFolderBrowser({read=readFolder,now=Date.now}={}) {
  let cache;let active=0;
  return async function browse(input,{search='',offset=0,hidden=false,signal}={}) {
    if(typeof search!=='string'||search.length>200||!Number.isInteger(offset)||offset<0||typeof hidden!=='boolean')throw new AppError('INVALID');
    if(input&&(typeof input!=='string'||!path.isAbsolute(input)||input.length>4096||/[\x00-\x1f]/.test(input)||/^\\\\[?.]\\/.test(input)))throw new AppError('STORAGE_PATH');
    if(active>=4)throw new AppError('FOLDER_BUSY');
    active++;
    try{
      const cached=cache&&now()-cache.time<30000?cache:null;
      const result=await read({path:input,search,offset,hidden,discover:!cached},{signal});
      if(signal?.aborted)throw new AppError('FOLDER_CANCELLED');
      const shortcuts=cached??{places:result.places.sort((a,b)=>({home:0,folder:1,drive:2}[a.kind]-{home:0,folder:1,drive:2}[b.kind])||a.name.localeCompare(b.name,undefined,{numeric:true})),placesIncomplete:result.placesIncomplete,time:now()};
      if(!cached)cache=shortcuts;
      return {...result.listing,places:shortcuts.places,placesIncomplete:shortcuts.placesIncomplete,roots:shortcuts.places.filter(p=>p.kind==='drive').map(p=>p.path)};
    }finally{active--;}
  };
}
export const browseFolders=createFolderBrowser();
