import {AppError} from './errors.js';
import {PDF_IMAGE_MAX_BYTES,PDF_IMAGE_MAX_PIXELS} from './web/pdf-image-model.js';
const fail=(code='MEDIA_INVALID')=>{throw new AppError(code);};
export const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];return (crc^0xffffffff)>>>0;};
export function canonicalPNG(bytes,{strict=false}={}){
 if(!Buffer.isBuffer(bytes)||bytes.length<45||bytes.length>PDF_IMAGE_MAX_BYTES||!bytes.subarray(0,8).equals(pngSignature))fail();
 const kept=[pngSignature];let offset=8,width=0,height=0,data=false,end=false,palette=false,transparency=false;
 while(offset<bytes.length){
  if(offset+12>bytes.length)fail();const size=bytes.readUInt32BE(offset),stop=offset+12+size;if(stop>bytes.length)fail();
  const name=bytes.toString('ascii',offset+4,offset+8),chunk=bytes.subarray(offset,stop);if(!/^[A-Za-z]{4}$/.test(name)||crc32(chunk.subarray(4,-4))!==chunk.readUInt32BE(chunk.length-4))fail();
  if(offset===8){if(name!=='IHDR'||size!==13)fail();width=chunk.readUInt32BE(8);height=chunk.readUInt32BE(12);if(!width||!height||width*height>PDF_IMAGE_MAX_PIXELS)fail('MEDIA_LIMIT');}
  else if(name==='IHDR')fail();
  if(name==='PLTE'){if(data||palette||!size||size%3||size>768)fail();palette=true;}
  if(name==='tRNS'){if(data||transparency||!size||size>256)fail();transparency=true;}
  if(name==='IDAT')data=true;
  if(name==='IEND'){if(size||!data||stop!==bytes.length)fail();end=true;}
  if(['IHDR','PLTE','tRNS','IDAT','IEND'].includes(name))kept.push(chunk);
  else if(strict||name[0]===name[0].toUpperCase())fail();
  offset=stop;
 }
 if(!end)fail();return {content:Buffer.concat(kept),width,height};
}
