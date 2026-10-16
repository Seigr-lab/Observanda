import {deflateSync} from 'node:zlib';
// WOFF 1 wrapper around the existing licensed TTF, retaining every table byte.
export function woffFixture(ttf){
 const count=ttf.readUInt16BE(4),header=Buffer.alloc(44+count*20),chunks=[header];let offset=header.length,total=12+count*16;
 header.write('wOFF');header.writeUInt32BE(ttf.readUInt32BE(0),4);header.writeUInt16BE(count,12);header.writeUInt16BE(1,20);
 for(let i=0;i<count;i++){
  const source=12+i*16,target=44+i*20,start=ttf.readUInt32BE(source+8),length=ttf.readUInt32BE(source+12),raw=ttf.subarray(start,start+length),compressed=deflateSync(raw),data=compressed.length<length?compressed:raw;
  ttf.copy(header,target,source,source+4);header.writeUInt32BE(offset,target+4);header.writeUInt32BE(data.length,target+8);header.writeUInt32BE(length,target+12);header.writeUInt32BE(ttf.readUInt32BE(source+4),target+16);
  const padding=Buffer.alloc((4-data.length%4)%4);chunks.push(data,padding);offset+=data.length+padding.length;total+=length+(4-length%4)%4;
 }
 header.writeUInt32BE(offset,8);header.writeUInt32BE(total,16);return Buffer.concat(chunks);
}
