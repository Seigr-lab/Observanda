import {createHash} from 'node:crypto';
import {PDF_ICC_MAX_BYTES} from './web/pdf-print-condition-model.js';
const fail=()=>{throw Object.assign(new Error('PDF_PRINT_PROFILE'),{code:'PDF_PRINT_PROFILE'});};
// ICC.1:2022 sections 10.12 and 10.13 define the bounded multi-stage layouts.
// https://www.color.org/specifications/ICC.1-2022-05.pdf
// Admission checks the bounded binary structure before retention. It does not
// assert that a supplied profile describes a particular physical printer.
export function inspectPdfIcc(input,{output=true}={}){
 if(!(input instanceof Uint8Array)||input.byteLength<132||input.byteLength>PDF_ICC_MAX_BYTES)fail();const b=Buffer.from(input.buffer,input.byteOffset,input.byteLength),u=at=>b.readUInt32BE(at),s=at=>b.toString('ascii',at,at+4),version=b[8],colorSpace=s(16).trim(),channels={RGB:3,CMYK:4,GRAY:1}[colorSpace],count=u(128);
 if(u(0)!==b.length||s(36)!=='acsp'||![2,4].includes(version)||!channels||!['XYZ ','Lab '].includes(s(20))||!(output?s(12)==='prtr':['prtr','mntr','scnr'].includes(s(12)))||b[10]||b[11]||u(64)>3||b.subarray(100,128).some(Boolean)||count<1||count>4096||132+12*count>b.length)fail();
 const tags=new Map(),ranges=[];for(let i=0;i<count;i++){const at=132+12*i,name=s(at),offset=u(at+4),size=u(at+8);if(tags.has(name)||offset%4||offset<132+12*count||size<8||offset+size>b.length||b.subarray(offset+4,offset+8).some(Boolean))fail();for(const [start,end]of ranges)if(offset<end&&offset+size>start&&(offset!==start||offset+size!==end))fail();tags.set(name,{offset,size,type:s(offset)});ranges.push([offset,offset+size]);}
 for(const name of ['desc','cprt','wtpt'])if(!tags.has(name))fail();
 if(tags.get('wtpt').type!=='XYZ '||tags.get('wtpt').size<20)fail();
 function curve(at,end){
  if(at+12>end||b.subarray(at+4,at+8).some(Boolean))fail();const type=s(at);let length;
  if(type==='curv')length=12+2*u(at+8);
  else if(type==='para'){const fn=b.readUInt16BE(at+8);if(fn>4||b[at+10]||b[at+11])fail();length=12+4*[1,3,4,5,7][fn];}
  else fail();if(at+length>end)fail();return at+length;
 }
 function lut(name,ins,outs){const tag=tags.get(name);if(!tag)fail();const {offset:o,size,type}=tag;let required;
  if(type==='mft1'||type==='mft2'){if(size<(type==='mft1'?48:52)||b[o+8]!==ins||b[o+9]!==outs||b[o+10]<2||b[o+11])fail();const grid=b[o+10],cells=grid**ins*outs;if(!Number.isSafeInteger(cells)||cells>PDF_ICC_MAX_BYTES)fail();if(type==='mft1')required=48+256*ins+cells+256*outs;else{const n=b.readUInt16BE(o+48),m=b.readUInt16BE(o+50);if(n<2||m<2)fail();required=52+2*(n*ins+cells+m*outs);}if(required>size||size-required>3)fail();}
  else if(type==='mAB '||type==='mBA '){
   if(size<32||b[o+8]!==ins||b[o+9]!==outs||b[o+10]||b[o+11])fail();
   const offsets=[12,16,20,24,28].map(at=>u(o+at)),[bc,matrix,mc,clut,ac]=offsets,used=offsets.filter(Boolean).sort((a,b)=>a-b);
   if(!bc||new Set(used).size!==used.length||!!matrix!==!!mc||!!clut!==!!ac||ins!==outs&&!clut)fail();
   for(const value of used)if(value<32||value%4||value>=size)fail();
   const endOf=value=>o+(used.find(n=>n>value)??size),curves=(value,n)=>{if(!value)return;const end=endOf(value);let at=o+value;for(let i=0;i<n;i++){at=curve(at,end);if(i<n-1){const aligned=(at+3)&~3;if(aligned>end||b.subarray(at,aligned).some(Boolean))fail();at=aligned;}}};
   const matrixChannels=type==='mAB '?outs:ins;curves(bc,matrixChannels);curves(mc,matrixChannels);curves(ac,type==='mAB '?ins:outs);
   if(matrix&&(matrixChannels!==3||o+matrix+48>endOf(matrix)))fail();
   if(clut){const at=o+clut,end=endOf(clut);if(at+20>end||b.subarray(at+ins,at+16).some(Boolean)||b.subarray(at+17,at+20).some(Boolean))fail();let cells=outs;for(let i=0;i<ins;i++){if(b[at+i]<2)fail();cells*=b[at+i];}const precision=b[at+16];if(![1,2].includes(precision)||!Number.isSafeInteger(cells)||at+20+precision*cells>end)fail();}
  }
  else fail();
 }
 for(const n of [0,1,2]){if(tags.has('A2B'+n))lut('A2B'+n,channels,3);if(tags.has('B2A'+n))lut('B2A'+n,3,channels);}
 if(output||colorSpace==='CMYK'){if(!tags.has('A2B0')||output&&!tags.has('B2A0'))fail();}
 else if(tags.has('A2B0'))lut('A2B0',channels,3);
 else for(const name of colorSpace==='RGB'?['rXYZ','gXYZ','bXYZ','rTRC','gTRC','bTRC']:['kTRC']){const tag=tags.get(name);if(!tag)fail();if(name.endsWith('XYZ')){if(tag.type!=='XYZ '||tag.size<20)fail();}else curve(tag.offset,tag.offset+tag.size);}
 return {sha256:createHash('sha256').update(b).digest('hex'),size:b.length,version,colorSpace,channels};
}
