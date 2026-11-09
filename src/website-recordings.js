import path from 'node:path';
import {AppError} from './errors.js';
import {FileContent,writeContent} from './file-content.js';
import {MediaStore} from './media.js';
import {MediaPolicy} from './media-policy.js';
import {withNativeDestination} from './native-destination.js';
import {isStorageTemporary} from './storage-temporary.js';
import {researchId} from './web/research-reference.js';

const stage='.observanda/website-files/recording-stage';
const resource=/^recordings\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(wav|mp4|vtt)$/;
const invalid=()=>{throw new AppError('INVALID');};
const valueType={wav:'audio/wav',mp4:'video/mp4',vtt:'text/vtt; charset=utf-8'};
export function websiteRecordingKind(file){
 const extension=resource.exec(file?.name)?.[1];
 if(file?.recording!==true||file.sourceId||!extension||file.contentType!==valueType[extension])return null;
 return {wav:'audio',mp4:'video',vtt:'track'}[extension];
}
export function publicRecordingNames(manifest){
 const projection=new Map((manifest.publicPageFiles??[]).map(({file})=>[file.name,file.references.map(r=>r.name).filter(name=>name.startsWith('recordings/'))]));
 return new Set(manifest.pages.filter(page=>!page.draft).flatMap(page=>projection.get(page.path)??page.recordings??[]));
}
const timestamp=/^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
function time(text){
 const match=timestamp.exec(text);if(!match)invalid();
 const value=((Number(match[1]??0)*60+Number(match[2]))*60+Number(match[3]))*1000+Number(match[4]);
 if(!Number.isSafeInteger(value))invalid();return value;
}
// Export timed text only. Strip document-level metadata, CSS and script-capable
// markup. Spoken words and sound descriptions remain actual caption text.
export function plainWebVTT(input){
 if(typeof input!=='string'||Buffer.byteLength(input)>2*1024*1024||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input))invalid();
 const blocks=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split(/\n[ \t]*\n+/);
 if(!/^WEBVTT(?:[ \t][^\n]*)?$/.test(blocks.shift()))invalid();
 const cues=[];let previous=-1;
 for(const block of blocks){
  const lines=block.split('\n');if(/^NOTE(?:$|\s)/.test(lines[0]))continue;
  if(!lines[0].includes('-->'))lines.shift();
  const cue=/^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+.*)?$/.exec(lines.shift()??'');
  if(!cue||!lines.length)invalid();
  const from=time(cue[1]);if(from<previous||time(cue[2])<=from)invalid();previous=from;
  // Preserve literal ampersands/entities while rendering markup as text.
  cues.push(cue[1]+' --> '+cue[2]+'\n'+lines.map(line=>line.replaceAll('<','&lt;').replaceAll('>','&gt;')).join('\n'));
 }
 if(!cues.length)invalid();return 'WEBVTT\n\n'+cues.join('\n\n')+'\n';
}

// Prefix metadata is bounded; the remaining request is streamed as a single
// original recording and never joins the metadata buffer.
export async function readRecordingUpload(request,signal){
 const iterator=request[Symbol.asyncIterator]();let chunk=Buffer.alloc(0);
 async function read(size){
  const result=Buffer.allocUnsafe(size);let offset=0;
  while(offset<size){
   signal?.throwIfAborted();if(!chunk.length){const item=await iterator.next();if(item.done)invalid();chunk=item.value;}
   const count=Math.min(chunk.length,size-offset);chunk.copy(result,offset,0,count);chunk=chunk.subarray(count);offset+=count;
  }
  return result;
 }
 const length=(await read(4)).readUInt32BE();if(!length||length>40*1024*1024)throw new AppError('LIMIT');
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read(length)));}catch{invalid();}
 if(!data||!researchId(data.siteId)||!/^[a-f0-9]{64}$/.test(data.expectedRevision)||!Array.isArray(data.tracks)||data.tracks.length>64)invalid();
 const uploads=[],seen=new Set();
 for(const track of data.tracks){
  if(!resource.test(track?.name)||!track.name.endsWith('.vtt')||seen.has(track.name))invalid();
  seen.add(track.name);uploads.push({name:track.name,bytes:Buffer.from(plainWebVTT(track.text)),contentType:valueType.vtt});
 }
 const media=data.recording;
 if(data.recoveredUpload&&(!media||!researchId(data.recoveredUpload.id)||!researchId(data.recoveredUpload.inputId)||!/^([a-f0-9]{64})$/.test(data.recoveredUpload.revision)))invalid();
 if(media){
  const extension=resource.exec(media.name)?.[1];
  if(!['wav','mp4'].includes(extension)||!Number.isSafeInteger(media.size)||media.size<=0||typeof media.label!=='string'||media.label.length>200)invalid();
 }
 async function* bytes(){
  let size=0;
  while(true){
   signal?.throwIfAborted();if(chunk.length){size+=chunk.length;if(size>(data.recoveredUpload?0:media?.size??0))invalid();yield chunk;chunk=Buffer.alloc(0);}
   const next=await iterator.next();if(next.done)break;chunk=next.value;
  }
  if(size!==(data.recoveredUpload?0:media?.size??0))invalid();
 }
 return {data,uploads,bytes};
}

export async function saveRecordingUpload(store,upload,{signal,check,recoverInput}={}){
 const {data,uploads,bytes}=upload;
 await store.checkRevision(data.siteId,data.expectedRevision);
 const save=async()=>{await check?.();return store.save(data.siteId,{expectedRevision:data.expectedRevision,path:data.path,html:data.html,css:data.css,historyKey:data.historyKey,recordings:uploads,signal});};
 if(!data.recording){for await(const _ of bytes())invalid();return save();}
 const {name,size,label}=data.recording,workspace=store.workspace,ext=resource.exec(name)[1],kind=ext==='wav'?'audio':'video';
 const {policy}=await new MediaPolicy(workspace).read();if(size>policy.maxUploadBytes)throw new AppError('MEDIA_LIMIT');
 // The private recording slot is on the selected workspace volume. Its native
 // lease covers conversion and recovery of a prior interrupted upload. Other
 // site reads, edits and permission updates continue during the transcode.
 return withNativeDestination(workspace.root,async scope=>{
  await scope.admit();await scope.ensure(stage);
  return scope.member(store.absolute(stage+'/writer'),async(parent,member)=>{
   let lease;
   try{lease=await parent.lease(member);}catch(error){if(error.code==='EBUSY')throw new AppError('LOCKED');throw error;}
   const clean=async()=>{for await(const item of parent.entries())if(!item.directory&&(item.name==='original'||item.name==='prepared'||isStorageTemporary(item.name))){const info=await parent.stat(item.name);await parent.remove(item.name,{identity:info.identity});}};
   try{
    await clean();
    const input=store.absolute(stage+'/original'),output=store.absolute(stage+'/prepared');
    let source;
    if(data.recoveredUpload){
     if(!recoverInput)invalid();for await(const _ of bytes())invalid();
     source=await recoverInput(data.recoveredUpload);
    }else{
     const original=await writeContent(workspace,input,bytes(),{exclusive:true,maxBytes:size,reserveBytes:policy.reserveBytes,signal});
     source=new FileContent(workspace,input,original.size,original.sha256);
    }
    if(source.size!==size)invalid();
    const result=await new MediaStore(workspace).prepare(source,kind,path.basename(name,'.'+ext),output,{policy,signal});
    uploads.push({name,bytes:new FileContent(workspace,output,result.bytes,result.sha256),contentType:result.mime,label});
    return await save();
   }finally{try{await clean();}finally{await lease.close();}}
  });
 });
}

export async function saveWebsiteRecordings(store,manifest,{files,pages,names,uploads=[],draft,signal}){
 const referenced=new Set(pages.flatMap(page=>page.recordings??[]));
 const known=new Map(files.filter(file=>file.recording).map(file=>[file.name,file]));
 const added=[],formerBlobs=new Set(manifest.files.map(file=>file.blob));
 const rollback=async()=>{for(const blob of new Set(added.map(file=>file.blob)))if(!formerBlobs.has(blob))await store.discardStaged(blob);};
 try{
  for(const upload of uploads){
   if(!resource.test(upload.name)||files.some(file=>file.name===upload.name)||known.has(upload.name)||!names.has(upload.name))invalid();
   const file={...await store.siteFile(manifest.id,upload.name,upload,{draft,signal}),recording:true,...(upload.label?{label:upload.label}:{})};
   known.set(file.name,file);added.push(file);
  }
  for(const name of names){const file=known.get(name);if(!websiteRecordingKind(file)||file.draft&&!draft)invalid();}
  return {files:[...files,...added].filter(file=>!file.recording||referenced.has(file.name)),rollback};
 }catch(error){await rollback();throw error;}
}

export async function websiteRecordingLibrary(store,id,{expectedRevision,path:page='index.html',after='',limit=30,signal}={}){
 if(typeof after!=='string'||!Number.isInteger(limit)||limit<1||limit>100)invalid();
 return store.scope(async()=>{
  const manifest=await store.current(id,expectedRevision),entry=manifest.pages.find(item=>item.path===page);
  if(!entry)invalid();
  const items=[];let more=false;
  for(const file of manifest.files){
   if(!websiteRecordingKind(file)||file.draft&&!entry.draft||file.name.endsWith('.vtt')||file.name<=after)continue;
   const {name,label,contentType,size}=file,at=items.findIndex(row=>row.name>name);
   items.splice(at===-1?items.length:at,0,{name,label,contentType,size});
   if(items.length>limit){items.pop();more=true;}
  }
  return {items,next:more?items.at(-1).name:null};
 },{signal});
}
