import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);return bytes;}
export function bleedPicture(){
 const width=300,height=100,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const raw=Buffer.alloc(height*(width*3+1));for(let y=0;y<height;y++)for(let x=0;x<width;x++)raw[y*(width*3+1)+1+x*3+Math.floor(x/100)]=255;
 const content=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
 return {asset:createHash('sha256').update(content).digest('hex'),mime:'image/png',width,height,content};
}
