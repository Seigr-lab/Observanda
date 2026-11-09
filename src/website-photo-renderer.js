import {parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {initWasm,Resvg} from '@resvg/resvg-wasm';

// Only a generated wrapper and admitted raster bytes enter the renderer.
// Each worker handles one image and is terminated on cancellation.
await initWasm(await readFile(new URL(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm'))));
parentPort.on('message',({bytes,width,height,widths})=>{
 try{
  const content=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(content.readUInt32BE(16)!==width||content.readUInt32BE(20)!==height)throw Error();
  const encoded=content.toString('base64'),copies=[];
  for(const size of widths){
   const renderedHeight=Math.max(1,Math.round(height*size/width));
   const renderer=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="'+size+'" height="'+renderedHeight+'"><image width="'+size+'" height="'+renderedHeight+'" preserveAspectRatio="none" xlink:href="data:image/png;base64,'+encoded+'"/></svg>');
   try{const result=renderer.render();try{copies.push(result.asPng());}finally{result.free();}}finally{renderer.free();}
  }
  parentPort.postMessage(copies,copies.map(value=>value.buffer));
 }catch{parentPort.postMessage(null);}
});
