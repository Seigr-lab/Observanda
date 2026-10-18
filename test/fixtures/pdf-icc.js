// Synthetic lookup tables exercise transport and colour-space plumbing; they
// do not characterize a physical printer and must never be used for production.
export function makePdfPrinterProfile({colorSpace='RGB'}={}){
 const channels={RGB:3,CMYK:4,GRAY:1}[colorSpace];if(!channels)throw Error('test colour space');
 const tag=(type,size)=>{const b=Buffer.alloc(size);b.write(type);return b;};
 const lut=(ins,outs)=>{const b=tag('mft1',48+256*ins+2**ins*outs+256*outs);b[8]=ins;b[9]=outs;b[10]=2;for(const at of [12,28,44])b.writeInt32BE(65536,at);let at=48;for(let c=0;c<ins;c++)for(let i=0;i<256;i++)b[at++]=i;for(let i=0;i<2**ins;i++)for(let c=0;c<outs;c++)b[at++]=c<ins?((i>>(ins-c-1))&1)*255:0;for(let c=0;c<outs;c++)for(let i=0;i<256;i++)b[at++]=i;return b;};
 const desc=tag('desc',12+16+8+70);desc.writeUInt32BE(16,8);desc.write('Synthetic print',12);const cprt=tag('text',24);cprt.write('Synthetic only',8);const white=tag('XYZ ',20);[.9642,1,.8249].forEach((v,i)=>white.writeInt32BE(Math.round(v*65536),8+i*4));
 const tags=[['desc',desc],['cprt',cprt],['wtpt',white],['A2B0',lut(channels,3)],['B2A0',lut(3,channels)]];let size=132+tags.length*12;for(const [,b]of tags)size=(size+b.length+3)&~3;
 const b=Buffer.alloc(size);b.writeUInt32BE(size,0);b[8]=2;b[9]=0x10;b.write('prtr',12);b.write(colorSpace.padEnd(4),16);b.write('XYZ ',20);b.write('acsp',36);[.9642,1,.8249].forEach((v,i)=>b.writeInt32BE(Math.round(v*65536),68+i*4));b.writeUInt32BE(tags.length,128);let offset=132+tags.length*12;for(let i=0;i<tags.length;i++){const [name,data]=tags[i],at=132+i*12;b.write(name,at);b.writeUInt32BE(offset,at+4);b.writeUInt32BE(data.length,at+8);data.copy(b,offset);offset=(offset+data.length+3)&~3;}return b;
}
