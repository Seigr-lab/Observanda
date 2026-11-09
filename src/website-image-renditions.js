import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {buffer} from 'node:stream/consumers';
import {descendants,attr,put} from './website-migration-views.js';
import {displayWidths} from './web/website-image-candidates.js';
import {AppError} from './errors.js';
import {nativeMediaAdmission} from './native-media-admission.js';
import {pngSignature} from './canonical-png.js';

async function renderWidths(file,width,height,widths,signal){
 const size=file.bytes?.length??file.content.size;
 const release=await nativeMediaAdmission.acquire(Math.ceil(64*1024*1024+width*height*8+size*6),{signal});
 let worker;
 try{
  const bytes=file.bytes??await buffer(file.content.readChunks(0,size-1,{signal}));
  signal?.throwIfAborted();worker=new Worker(new URL('./website-photo-renderer.js',import.meta.url));
  return await new Promise((resolve,reject)=>{
   const abort=()=>finish(reject,signal.reason),fail=()=>finish(reject,new AppError('MEDIA_INVALID'));
   const success=value=>value?finish(resolve,value):fail();
   function finish(callback,value){
    worker.off('error',fail);worker.off('exit',fail);worker.off('message',success);
    signal?.removeEventListener('abort',abort);callback(value);
   }
   worker.once('error',fail);worker.once('exit',fail);worker.once('message',success);
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted){abort();return;}
   worker.postMessage({bytes,width,height,widths});
  });
 }finally{try{await worker?.terminate();}finally{release();}}
}

// The lab owns the original evidence. This converter receives the permitted
// publication master; its display sizes are withdrawn with the same grant.
export async function addPhotoRenditions(article,assets,signal){
 const byPath=new Map(assets.map(asset=>[asset.path,asset]));
 const groups=new Map();
 for(const image of descendants(article)){
  if(image.tagName!=='img')continue;
  const file=byPath.get(attr(image,'src'));if(file?.contentType!=='image/png')continue;
  if(!groups.has(file))groups.set(file,[]);
  groups.get(file).push(image);
 }
 for(const [file,images] of groups){
   signal?.throwIfAborted();
   const header=file.bytes??file.content?.header;
   if(!header||header.length<24||!header.subarray(0,8).equals(pngSignature))throw new AppError('MEDIA_INVALID');
   const width=header.readUInt32BE(16),height=header.readUInt32BE(20),widths=displayWidths(width,height);
   if(!widths.length)continue;
   const copies=await renderWidths(file,width,height,widths,signal);
   const candidates=[];
   for(const [i,copy] of copies.entries()){
    const bytes=Buffer.from(copy.buffer,copy.byteOffset,copy.byteLength),path='assets/'+createHash('sha256').update(bytes).digest('hex')+'.png';
    if(!byPath.has(path)){const asset={path,bytes,contentType:'image/png'};assets.push(asset);byPath.set(path,asset);}
    candidates.push(path+' '+widths[i]+'w');
   }
   candidates.push(file.path+' '+width+'w');
   for(const image of images){
    put(image,'srcset',candidates.join(', '));put(image,'sizes','auto, 100vw');put(image,'loading','lazy');
    put(image,'width',String(width));put(image,'height',String(height));
   }
 }
}
