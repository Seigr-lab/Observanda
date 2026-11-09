import {randomUUID} from 'node:crypto';
import {withNativeDestination} from './native-destination.js';
import {FileContent,writeContent} from './file-content.js';
import {MediaPolicy} from './media-policy.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';

const invalid=()=>{throw new AppError('INVALID');};
const fields=['kind','reuse','title','transcript','preload','language','trackLabel','trackKind'];
export function recordingDraftForm(input){
 if(input==null)return null;
 if(!Number.isSafeInteger(input.index)||input.index< -1||typeof input.fields!=='object'||!input.fields)invalid();
 const values={};for(const field of fields){
  const value=input.fields[field];if(typeof value!=='string'||value.length>(field==='transcript'?8*1024*1024:1000))invalid();values[field]=value;
 }
 if(!Array.isArray(input.removed)||input.removed.length>10000||!input.removed.every(n=>Number.isSafeInteger(n)&&n>=0)||typeof input.defaultTrack!=='boolean')invalid();
 const files={};
 for(const slot of ['upload','vtt']){
  const file=input.files?.[slot];if(!file)continue;
  if(!researchId(file.id)||typeof file.name!=='string'||!file.name||file.name.length>255||/[\/\\\u0000-\u001f]/.test(file.name)||!Number.isSafeInteger(file.size)||file.size<1||slot==='vtt'&&file.size>2*1024*1024)invalid();
  files[slot]={id:file.id,name:file.name,size:file.size};
 }
 return {index:input.index,fields:values,removed:input.removed,defaultTrack:input.defaultTrack,files};
}

async function inputReader(request,signal){
 const iterator=request[Symbol.asyncIterator]();let chunk=Buffer.alloc(0);
 async function* take(size){
  while(size){
   signal?.throwIfAborted();if(!chunk.length){const next=await iterator.next();if(next.done)invalid();chunk=next.value;}
   const length=Math.min(size,chunk.length);yield chunk.subarray(0,length);chunk=chunk.subarray(length);size-=length;
  }
 }
 async function read(size){const parts=[];for await(const bytes of take(size))parts.push(bytes);return Buffer.concat(parts,size);}
 const length=(await read(4)).readUInt32BE();if(!length||length>40*1024*1024)throw new AppError('LIMIT');
 let data;try{data=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await read(length)));}catch{invalid();}
 return {data,take,finish:async()=>{if(chunk.length||!(await iterator.next()).done)invalid();}};
}

export async function writeRecordingDraft(store,request,{save,register,finishDraft},{signal}){
 const {data,take,finish}=await inputReader(request,signal);if(!data||typeof data!=='object'||Array.isArray(data))invalid();
 const site=data.siteId,id=data.id;
 if(!researchId(site)||!researchId(id)||!Array.isArray(data.uploadSlots)||!data.uploadSlots.length||data.uploadSlots.length>2||new Set(data.uploadSlots).size!==data.uploadSlots.length)invalid();
 const form=recordingDraftForm(data.recordingForm);if(!form||data.uploadSlots.some(slot=>!['upload','vtt'].includes(slot)||!form.files[slot]))invalid();
 const owner='.observanda/website-files/sites/'+site+'/recovery/'+id,directory=owner+'/inputs';
 const {policy}=await new MediaPolicy(store.workspace).read();
 const manifest=await store.scope(()=>store.current(site,data.baseRevision),{signal});if(!manifest.pages.some(p=>p.path===data.path))invalid();
 // A large input uses its own private lease. Site edits and permission
 // withdrawals remain available throughout the transfer.
 return withNativeDestination(store.workspace.root,async scope=>{
  await scope.admit();await scope.ensure(directory);
  return scope.member(store.absolute(directory+'/writer'),async(parent,name)=>{
   const lease=await parent.lease(name),created=[];
   try{
    await register(store,site,data.path,id,signal);
    const head=await store.scope(()=>store.control(owner+'/head.json',{missing:true}),{signal});
    const keep=new Set((head?.inputs??[]).map(f=>f.blob));
    for await(const item of parent.entries()){
     const blob=directory+'/'+item.name;
     if(!item.directory&&/^[a-f0-9-]{36}\.bin$/.test(item.name)&&!keep.has(blob))await scope.remove(store.absolute(blob),{missing:true});
    }
    for(const slot of data.uploadSlots){
     const file=form.files[slot];if(slot==='upload'&&file.size>policy.maxUploadBytes)throw new AppError('MEDIA_LIMIT');
     const blob=directory+'/'+randomUUID()+'.bin';
     const saved=await writeContent(store.workspace,store.absolute(blob),take(file.size),{maxBytes:file.size,reserveBytes:policy.reserveBytes,exclusive:true,signal});
     created.push({...file,slot,blob,sha256:saved.sha256});
    }
    await finish();
    return await save(store,site,{...data,receivePictures:undefined,recordingForm:form,uploadedInputs:created,signal});
   }finally{
    try{await finishDraft(store,site,data.path,id);}finally{await lease.close();}
   }
  });
 });
}
export const privateInputContent=(store,file)=>new FileContent(store.workspace,store.absolute(file.blob),file.size,file.sha256);
