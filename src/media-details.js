import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {buffer} from 'node:stream/consumers';
import {AppError} from './errors.js';
import {FileContent,writeContent} from './file-content.js';
import {nativeMediaAdmission} from './native-media-admission.js';
import {pngSignature} from './canonical-png.js';
import {readCaptureMetadata} from './media-capture-metadata.js';
import {privateDirectory} from './storage.js';
import {realpath} from 'node:fs/promises';

export const THUMBNAIL_WIDTHS=[160,320,640];
const CAPTURE_SCAN=256*1024;

// Facts about one retained media file for the lab book reader and editor:
// probed technical details and, for photographs, the capture details the
// camera wrote into the original. Reading never changes the original.
export async function mediaDetails(media,id,{signal}={}){
 const known=await media.metadata(id),{metadata}=known;
 let capture=null;
 if(metadata.kind==='image'&&metadata.originalBytes>0){
  const original=await media.originalContent(id,known),chunks=[];
  for await(const chunk of original.readChunks(0,Math.min(original.size,CAPTURE_SCAN)-1,{signal}))chunks.push(chunk);
  capture=readCaptureMetadata(Buffer.concat(chunks));
 }
 return {id,kind:metadata.kind,technical:metadata.technical??null,capture};
}

function renderWidth(bytes,width,height,size,signal){
 // The website photo renderer draws one admitted PNG at the given widths.
 const worker=new Worker(new URL('./website-photo-renderer.js',import.meta.url));
 return new Promise((resolve,reject)=>{
  const finish=(callback,value)=>{signal?.removeEventListener('abort',abort);void worker.terminate();callback(value);};
  const abort=()=>finish(reject,signal.reason),fail=()=>finish(reject,new AppError('MEDIA_INVALID'));
  worker.once('error',fail);worker.once('exit',fail);
  worker.once('message',copies=>copies?.[0]?finish(resolve,Buffer.from(copies[0].buffer,copies[0].byteOffset,copies[0].byteLength)):fail());
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return abort();
  worker.postMessage({bytes,width,height,widths:[size]});
 });
}
// A reduced PNG of a record image, so galleries never load full-resolution
// copies. Thumbnails are derived caches beside the display copy: they are
// rebuilt when missing and never replace the original or the display copy.
export async function mediaThumbnail(media,id,width,{signal}={}){
 if(!THUMBNAIL_WIDTHS.includes(width))throw new AppError('INVALID');
 const {metadata}=await media.metadata(id);if(metadata.kind!=='image')throw new AppError('INVALID');
 const display=await media.get(id,{streamed:true,signal,headerBytes:24}),header=display.bytes.header;
 if(!header||header.length<24||!header.subarray(0,8).equals(pngSignature))throw new AppError('MEDIA_INVALID');
 const pixelWidth=header.readUInt32BE(16),pixelHeight=header.readUInt32BE(20);
 if(pixelWidth<=width)return {bytes:display.bytes,mime:'image/png',width:pixelWidth,height:pixelHeight};
 const height=Math.max(1,Math.round(pixelHeight*width/pixelWidth));
 // Kept outside the media folder, whose files are the original and its display copy.
 const folder=await privateDirectory(await realpath(media.root),'.observanda/media-thumbnails'),file=path.join(folder,id+'-'+width+'.png'),descriptor=path.join(folder,id+'-'+width+'.json');
 // An encrypted sidecar names the cached copy's size and digest for verified reads.
 const cached=await media.workspace.readFile(descriptor,'utf8',1024).catch(()=>null);
 if(cached){
  try{const {size,sha256,source}=JSON.parse(cached);if(source===metadata.sha256){const content=new FileContent(media.workspace,file,size,sha256);await content.verifyMetadata({signal});return {bytes:content,mime:'image/png',width,height};}}catch(error){if(signal?.aborted)throw error;}
 }
 const release=await nativeMediaAdmission.acquire(Math.ceil(64*1024*1024+pixelWidth*pixelHeight*8+metadata.bytes*6),{signal});let copy;
 try{copy=await renderWidth(await buffer(display.bytes.readChunks(0,display.bytes.size-1,{signal})),pixelWidth,pixelHeight,width,signal);}finally{release();}
 // Caching is best effort: a read-only or retired media folder still serves the copy.
 try{const saved=await writeContent(media.workspace,file,[copy],{signal});await media.workspace.writeFile(descriptor,JSON.stringify({size:saved.size,sha256:saved.sha256,source:metadata.sha256}));}catch(error){if(signal?.aborted)throw error;}
 return {bytes:copy,mime:'image/png',width,height};
}
