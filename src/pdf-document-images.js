// PDF images retain only a sanitized display copy. Source names, paths and
// original metadata never enter the independent PDF domain.
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from './storage.js';
import {clearVault} from './encryption.js';
import {MediaStore} from './media.js';
import {FileContent,contentBuffer,writeContent} from './file-content.js';
import {defaultMediaPolicy} from './media-policy.js';
import {RecordValueTree} from './record-value-tree.js';
import {RetainedTableIndex} from './retained-table-index.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {PDF_IMAGE_MAX_BYTES,PDF_IMAGE_MAX_PIXELS} from './web/pdf-image-model.js';
const fail=(code='MEDIA_INVALID')=>{throw new AppError(code);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.split(',').sort().join();
const preparedImages=new WeakMap(),signature=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];return (crc^0xffffffff)>>>0;};
function raster(bytes){
 return bytes.subarray(0,8).equals(signature)||bytes[0]===255&&bytes[1]===216&&bytes[2]===255||bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'||bytes.toString('ascii',0,2)==='BM'||bytes.subarray(0,4).equals(Buffer.from([73,73,42,0]))||bytes.subarray(0,4).equals(Buffer.from([77,77,0,42]));
}
function canonicalPNG(bytes,{strict=false}={}){
 if(!Buffer.isBuffer(bytes)||bytes.length<45||bytes.length>PDF_IMAGE_MAX_BYTES||!bytes.subarray(0,8).equals(signature))fail();
 const kept=[signature];let offset=8,width=0,height=0,data=false,end=false,palette=false,transparency=false;
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
export async function preparePdfImage(input,{signal}={}){
 signal?.throwIfAborted();if(!(input instanceof Uint8Array)||!input.byteLength||input.byteLength>PDF_IMAGE_MAX_BYTES)fail('MEDIA_LIMIT');
 const bytes=Buffer.from(input);if(!raster(bytes))fail();
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-image-')),vault={id:randomUUID(),key:randomBytes(32)},workspace=new Workspace(directory,vault);
 try{
  const inputPath=path.join(directory,'source'),output=path.join(directory,'prepared'),source=await writeContent(workspace,inputPath,[bytes],{maxBytes:PDF_IMAGE_MAX_BYTES,signal});
  const policy={...defaultMediaPolicy(),maxUploadBytes:PDF_IMAGE_MAX_BYTES,maxPreparedBytes:PDF_IMAGE_MAX_BYTES,maxImagePixels:PDF_IMAGE_MAX_PIXELS,processingTimeoutSeconds:60};
  const result=await new MediaStore(workspace).prepare(new FileContent(workspace,inputPath,source.size,source.sha256),'image',randomUUID(),output,{policy,signal});
  const canonical=canonicalPNG(await contentBuffer(new FileContent(workspace,output,result.bytes,result.sha256)));signal?.throwIfAborted();
  const metadata=Object.freeze({asset:digest(canonical.content),mime:'image/png',size:canonical.content.length,width:canonical.width,height:canonical.height});preparedImages.set(metadata,canonical.content);return metadata;
 }finally{
  clearVault(vault);bytes.fill(0);
  if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-image-'))fail('UNSAFE');
  await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
}
class ImageBlocks{
 constructor(store,id,signal){this.store=store;this.id=id;this.signal=signal;}
 key(kind,revision){if(!['value','index'].includes(kind)||!revisionId(revision))fail('CATALOGUE_DAMAGED');return 'pdf:image-block:'+this.id+':'+kind+':'+revision;}
 async put(kind,node){this.signal?.throwIfAborted();const text=serialize(node);if(Buffer.byteLength(text)>65536)fail('MEDIA_LIMIT');const revision=digest(text),key=this.key(kind,revision),old=await this.store.object(key);if(old!==null){if(serialize(old)!==text)fail('CATALOGUE_DAMAGED');}else await this.store.putObject(key,node);return revision;}
 async read(kind,revision){this.signal?.throwIfAborted();const node=await this.store.object(this.key(kind,revision));if(!node||Buffer.byteLength(serialize(node))>65536||digest(serialize(node))!==revision)fail('CATALOGUE_DAMAGED');return node;}
}
const projection=value=>({asset:value.asset,mime:value.mime,size:value.size,width:value.width,height:value.height});
export class PdfDocumentImages{
 constructor(store,id){if(store?.domain!=='pdf'||!researchId(id))fail('INVALID');this.store=store;this.id=id;}
 key(asset){if(!revisionId(asset))fail('INVALID');return 'pdf:image:'+this.id+':'+asset;}
 async descriptor(asset){
  const value=await this.store.object(this.key(asset));if(value===null)fail('NOT_FOUND');
  if(!exact(value,'version,documentId,asset,mime,size,width,height,root')||value.version!==1||value.documentId!==this.id||value.asset!==asset||value.mime!=='image/png'||!Number.isSafeInteger(value.size)||value.size<45||value.size>PDF_IMAGE_MAX_BYTES||!Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<1||value.height<1||value.width*value.height>PDF_IMAGE_MAX_PIXELS||!revisionId(value.root))fail('CATALOGUE_DAMAGED');return value;
 }
 async retain(prepared,{signal}={}){
  signal?.throwIfAborted();const bytes=preparedImages.get(prepared);if(!bytes)fail('INVALID');
  const old=await this.store.object(this.key(prepared.asset));if(old!==null){const saved=await this.read(prepared.asset,{signal});if(!saved.content.equals(bytes))fail('CATALOGUE_DAMAGED');return projection(saved);}
  const root=await new RecordValueTree(new ImageBlocks(this.store,this.id,signal)).retain(bytes.toString('base64'));
  signal?.throwIfAborted();await this.store.putObject(this.key(prepared.asset),{version:1,documentId:this.id,...prepared,root});return {...prepared};
 }
 async read(asset,{signal}={}){
  signal?.throwIfAborted();const value=await this.descriptor(asset),tree=new RecordValueTree(new ImageBlocks(this.store,this.id,signal)),chunks=[],encodedSize=4*Math.ceil(value.size/3)+2;let size=0;
  for await(const chunk of tree.json(value.root,{canonical:true,signal})){size+=Buffer.byteLength(chunk);if(size>encodedSize)fail('CATALOGUE_DAMAGED');chunks.push(chunk);}
  let encoded;try{encoded=JSON.parse(chunks.join(''));}catch{fail('CATALOGUE_DAMAGED');}
  if(typeof encoded!=='string'||size!==encodedSize)fail('CATALOGUE_DAMAGED');const content=Buffer.from(encoded,'base64');
  if(content.length!==value.size||content.toString('base64')!==encoded||digest(content)!==value.asset)fail('CATALOGUE_DAMAGED');
  try{const image=canonicalPNG(content,{strict:true});if(image.width!==value.width||image.height!==value.height)fail('CATALOGUE_DAMAGED');}catch{fail('CATALOGUE_DAMAGED');}
  signal?.throwIfAborted();return {...projection(value),content};
 }
 async verify({signal}={}){let images=0;for await(const key of this.store.objectIdEntries('pdf:image:'+this.id+':',{signal})){await this.read(key.slice(('pdf:image:'+this.id+':').length),{signal});images++;}return {images};}
}
export async function verifyPdfImages(store,{signal}={}){
 if(store?.domain!=='pdf')fail('INVALID');let images=0,blocks=0;
 for await(const key of store.objectIdEntries('pdf:image:',{signal})){
  const match=/^pdf:image:([^:]+):([a-f0-9]{64})$/.exec(key);if(!match||!researchId(match[1]))fail('CATALOGUE_DAMAGED');await new PdfDocumentImages(store,match[1]).read(match[2],{signal});images++;
 }
 for await(const key of store.objectIdEntries('pdf:image-block:',{signal})){
  signal?.throwIfAborted();const match=/^pdf:image-block:([^:]+):(value|index):([a-f0-9]{64})$/.exec(key);if(!match||!researchId(match[1]))fail('CATALOGUE_DAMAGED');const owner=new ImageBlocks(store,match[1],signal),node=await owner.read(match[2],match[3]);
  try{if(match[2]==='value')await new RecordValueTree(owner).node(match[3]);else new RetainedTableIndex(owner,{namespace:'index',allowSparseBranches:true}).make(node);}catch{fail('CATALOGUE_DAMAGED');}blocks++;
 }
 return {images,blocks};
}
