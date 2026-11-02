import {AppError} from './errors.js';
import {canonicalPNG} from './canonical-png.js';
import {PDF_IMAGE_MAX_BYTES} from './web/pdf-image-model.js';

// Length-prefixed JSON followed by the normalized pictures in document order.
// The browser streams the Blob and the service holds at most one image at a time.
export async function websitePictureUpload(request,signal){
 const input=request[Symbol.asyncIterator]();let chunk=Buffer.alloc(0);
 const invalid=()=>{throw new AppError('INVALID');};
 async function read(size){
  const bytes=Buffer.allocUnsafe(size);let at=0;
  while(at<size){
   signal?.throwIfAborted();
   if(!chunk.length){const part=await input.next();if(part.done)invalid();chunk=part.value;}
   const length=Math.min(size-at,chunk.length);chunk.copy(bytes,at,0,length);chunk=chunk.subarray(length);at+=length;
  }
  return bytes;
 }
 const size=(await read(4)).readUInt32BE();if(!size||size>32*1024*1024)throw new AppError('LIMIT');
 let data;try{data=JSON.parse((await read(size)).toString('utf8'));}catch{invalid();}
 if(!Array.isArray(data?.pictures)||!data.pictures.length)invalid();
 const seen=new Set();
 for(const item of data.pictures){
  if(!/^pictures\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.png$/.test(item?.name)||seen.has(item.name))invalid();
  if(!Number.isSafeInteger(item.size)||item.size<=0||item.size>PDF_IMAGE_MAX_BYTES)throw new AppError('MEDIA_LIMIT');
  seen.add(item.name);
 }
 async function* pictures(){
  for(const {name,size} of data.pictures)yield {name,bytes:canonicalPNG(await read(size)).content};
  if(chunk.length||!(await input.next()).done)invalid();
 }
 return {data,pictures};
}
