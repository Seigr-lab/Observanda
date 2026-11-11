import {readCaptureMetadata} from './media-capture-metadata.js';

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
