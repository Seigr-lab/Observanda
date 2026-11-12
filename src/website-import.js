import {inflateRawSync,crc32} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {websiteFileName,validateWebsiteHTML,validateWebsiteCSS} from './website-file-policy.js';
import {withNativeTree,nativeTreeFiles,nativeMemberCursor} from './native-storage-tree.js';
import {nativeFileBlocks} from './native-destination.js';

// An existing static website becomes a new standalone website. Lab book
// content can enter a website only through its source projection, which
// re-applies sharing choices on every change; a copied placement would freeze
// research content outside that projection. Files carrying Observanda source,
// feed or component markers are therefore refused, never stripped.
export const websiteImportLimits={files:4000,bytes:256*1024*1024,file:64*1024*1024,zipComment:65535};
const labBookMarkers=new Set(['data-observanda-source','data-observanda-link','data-observanda-part','data-observanda-editor','data-website-source-gallery','data-website-feed','data-website-instance']);
const ignored=name=>{const parts=name.split('/');return parts.some(part=>part.startsWith('.')&&part!=='.nojekyll'||part==='__MACOSX')||/^(?:thumbs\.db|desktop\.ini)$/i.test(parts.at(-1));};
const issue=(file,reason,line)=>({file,reason,...(line?{line}:{})});

function utf8(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}}
function lineAt(text,offset){return Number.isSafeInteger(offset)?text.slice(0,offset).split('\n').length:undefined;}
function carriesLabBookContent(html){
 const pending=[parse(html)];
 while(pending.length){
  const node=pending.pop();
  if(node.attrs?.some(attr=>labBookMarkers.has(attr.name)||attr.name.startsWith('data-observanda-')))return true;
  for(const child of node.childNodes??[])pending.push(child);
  if(node.content)pending.push(node.content);
 }
 return false;
}

// A ZIP of a folder often wraps every file in that folder's name.
function unwrap(entries){
 if(entries.some(entry=>entry.name==='index.html'))return entries;
 const roots=new Set(entries.map(entry=>entry.name.split('/')[0]));
 if(roots.size!==1)return entries;
 const [root]=roots;if(!entries.some(entry=>entry.name===root+'/index.html'))return entries;
 return entries.map(entry=>({...entry,name:entry.name.slice(root.length+1)}));
}

export function reviewWebsiteImport(input){
 const issues=[],skipped=[],files=new Map(),seen=new Set();
 const entries=unwrap(input.filter(entry=>{if(ignored(entry.name)){skipped.push(entry.name);return false;}return true;}));
 for(const entry of entries){
  const key=entry.name.toLowerCase();
  if(seen.has(key)){issues.push(issue(entry.name,'importDuplicate'));continue;}seen.add(key);
  try{websiteFileName(entry.name);}catch{issues.push(issue(entry.name,'importName'));continue;}
  if(/\.(?:html|css|js)$/i.test(entry.name)){
   const text=utf8(entry.bytes);if(text===null){issues.push(issue(entry.name,'importEncoding'));continue;}
   files.set(entry.name,text);
  }else files.set(entry.name,entry.bytes);
 }
 if(!files.has('index.html'))issues.push(issue('index.html','importIndex'));
 const scripts=new Set([...files.keys()].filter(name=>name.endsWith('.js')));
 for(const [name,value] of files){
  if(typeof value!=='string')continue;
  try{
   if(name.endsWith('.html')){
    if(carriesLabBookContent(value)){issues.push(issue(name,'importLabBook'));continue;}
    validateWebsiteHTML(value,{scripts,file:name,diagnose:true});
   }else if(name.endsWith('.css'))validateWebsiteCSS(value,{file:name,diagnose:true});
  }catch(error){
   const diagnostic=error.sourceDiagnostic;
   issues.push(diagnostic?issue(name,'sourceReason_'+diagnostic.reason,lineAt(value,diagnostic.start)):issue(name,error.code==='LIMIT'?'importLimit':'importInvalid'));
  }
 }
 return {files,issues,skipped};
}

// Bounded, traversal-safe reading of a ZIP archive held in memory. Stored and
// deflated entries are accepted, including ZIP64 archives such as the website
// ZIP Observanda exports; every size, offset and checksum is verified.
const safe=value=>{const number=Number(value);if(!Number.isSafeInteger(number)||number<0)throw new AppError('INVALID');return number;};
function zip64Fields(zip,start,length,wanted){
 const values={};let at=start;const end=start+length;
 while(at+4<=end){
  const id=zip.readUInt16LE(at),size=zip.readUInt16LE(at+2),body=at+4;if(body+size>end)throw new AppError('INVALID');
  if(id===1){let field=body;for(const key of wanted){if(field+8>body+size)throw new AppError('INVALID');values[key]=safe(zip.readBigUInt64LE(field));field+=8;}return values;}
  at=body+size;
 }
 if(wanted.length)throw new AppError('INVALID');return values;
}
export function readWebsiteZip(zip,limits=websiteImportLimits){
 if(!Buffer.isBuffer(zip)||zip.length<22)throw new AppError('INVALID');
 let end=-1;for(let at=zip.length-22;at>=Math.max(0,zip.length-22-limits.zipComment);at--)if(zip.readUInt32LE(at)===0x06054b50){end=at;break;}
 if(end<0)throw new AppError('INVALID');
 let count=zip.readUInt16LE(end+10),size=zip.readUInt32LE(end+12),offset=zip.readUInt32LE(end+16),limit=end;
 if(count===0xffff||size===0xffffffff||offset===0xffffffff){
  const locator=end-20;if(locator<0||zip.readUInt32LE(locator)!==0x07064b50)throw new AppError('INVALID');
  const record=safe(zip.readBigUInt64LE(locator+8));if(record+56>locator||zip.readUInt32LE(record)!==0x06064b50)throw new AppError('INVALID');
  count=safe(zip.readBigUInt64LE(record+32));size=safe(zip.readBigUInt64LE(record+40));offset=safe(zip.readBigUInt64LE(record+48));limit=record;
 }
 if(offset+size>limit)throw new AppError('INVALID');
 if(count>limits.files)throw new AppError('LIMIT');
 const entries=[];let at=offset,total=0;
 for(let index=0;index<count;index++){
  if(at+46>offset+size||zip.readUInt32LE(at)!==0x02014b50)throw new AppError('INVALID');
  const flags=zip.readUInt16LE(at+8),method=zip.readUInt16LE(at+10),crc=zip.readUInt32LE(at+16);
  let packed=zip.readUInt32LE(at+20),length=zip.readUInt32LE(at+24),local=zip.readUInt32LE(at+42);
  const nameLength=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32);
  if(at+46+nameLength+extra+comment>offset+size)throw new AppError('INVALID');
  const raw=zip.subarray(at+46,at+46+nameLength),name=(flags&0x800?utf8(raw):utf8(raw)??raw.toString('latin1'))?.replaceAll('\\','/');
  const wanted=[...(length===0xffffffff?['length']:[]),...(packed===0xffffffff?['packed']:[]),...(local===0xffffffff?['local']:[])];
  if(wanted.length){const values=zip64Fields(zip,at+46+nameLength,extra,wanted);length=values.length??length;packed=values.packed??packed;local=values.local??local;}
  at+=46+nameLength+extra+comment;
  if(name===null||name===undefined)throw new AppError('INVALID');
  if(name.endsWith('/'))continue;
  if(flags&0x1||![0,8].includes(method))throw new AppError('INVALID');
  if(length>limits.file||(total+=length)>limits.bytes)throw new AppError('LIMIT');
  if(local+30>zip.length||zip.readUInt32LE(local)!==0x04034b50)throw new AppError('INVALID');
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
  if(start+packed>zip.length)throw new AppError('INVALID');
  const data=zip.subarray(start,start+packed);
  let bytes;try{bytes=method===0?Buffer.from(data):inflateRawSync(data,{maxOutputLength:Math.max(length,1)});}catch{throw new AppError('INVALID');}
  if(bytes.length!==length||crc32(bytes)!==crc)throw new AppError('INVALID');
  entries.push({name,bytes});
 }
 return entries;
}

// Reads regular files below a chosen folder through the native handle service,
// which refuses links and reparse points and detects files changed mid-read.
export async function readWebsiteFolder(directory,{signal,limits=websiteImportLimits}={}){
 if(typeof directory!=='string'||!directory)throw new AppError('INVALID');
 return withNativeTree(directory,async root=>{
  const listed=[];let total=0;
  for await(const file of nativeTreeFiles(root,'',name=>!ignored(name))){
   signal?.throwIfAborted();
   if(listed.length>=limits.files)throw new AppError('LIMIT');
   if(file.bytes>limits.file||(total+=file.bytes)>limits.bytes)throw new AppError('LIMIT');
   listed.push(file.name);
  }
  const cursor=nativeMemberCursor(root),entries=[];
  try{
   for(const name of listed.sort()){
    const {directory:parent,name:member}=await cursor.member(name),handle=await parent.file(member,{mode:'read'}),chunks=[];
    try{for await(const block of nativeFileBlocks(handle,1024*1024,signal,limits.file))chunks.push(Buffer.from(block));}
    finally{await handle.close();}
    entries.push({name,bytes:Buffer.concat(chunks)});
   }
  }finally{await cursor.close();}
  return entries;
 });
}

// An upload is a four-byte header length, a JSON header naming the website, and
// the archive bytes, read without exceeding the import size limit.
export async function readWebsiteImportUpload(request,{signal,limits=websiteImportLimits}={}){
 const chunks=[];let size=0;
 for await(const chunk of request){
  signal?.throwIfAborted();size+=chunk.length;
  if(size>limits.bytes+64*1024)throw new AppError('LIMIT');
  chunks.push(chunk);
 }
 const body=Buffer.concat(chunks,size);if(body.length<4)throw new AppError('INVALID');
 const length=body.readUInt32BE(0);if(!length||length>64*1024||4+length>body.length)throw new AppError('INVALID');
 let header;try{header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body.subarray(4,4+length)));}catch{throw new AppError('INVALID');}
 if(!header||typeof header!=='object'||Array.isArray(header)||Object.keys(header).some(key=>key!=='name')||typeof header.name!=='string')throw new AppError('INVALID');
 return {name:header.name,zip:body.subarray(4+length)};
}

// Returns the new website, or the problems that prevented the import. Nothing
// is written unless every file is accepted.
export async function importStaticWebsite(store,{name,read,source,signal}){
 let entries;
 try{entries=await read();}
 catch(error){
  const reason=error.code==='LIMIT'?'importLimit':error.code==='UNSAFE'?'importUnsafe':error.code==='INVALID'&&source==='zip'?'importZipDamaged':null;
  if(!reason)throw error;
  return {issues:[issue('',reason)],issueCount:1,skipped:0};
 }
 const review=reviewWebsiteImport(entries);
 if(review.issues.length)return {issues:review.issues.slice(0,200),issueCount:review.issues.length,skipped:review.skipped.length};
 try{return {...await store.importFiles(randomUUID(),{name,files:review.files,signal}),skipped:review.skipped.length};}
 catch(error){
  if(error.code==='INVALID'||error.code==='UNSAFE'||error.code==='LIMIT'||error.code==='PRIVACY')return {issues:[issue('',error.code==='PRIVACY'?'importPrivacy':error.code==='LIMIT'?'importLimit':'importInvalid')],issueCount:1,skipped:review.skipped.length};
  throw error;
 }
}
