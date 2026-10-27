import {openPublicationInput} from './publication-input-reader.js';
import {isStorageTemporary} from './storage-temporary.js';
import path from 'node:path';
import {readdir,unlink,rmdir} from 'node:fs/promises';
import {AppError} from './errors.js';
import {privateDirectory,assertRegular} from './storage.js';
import {FileContent,writeContent,contentStream,contentSize,contentHash} from './file-content.js';
import {researchId} from './web/research-reference.js';
import {MediaStore} from './media.js';
const profiles={image:['png','image/png'],audio:['wav','audio/wav'],video:['mp4','video/mp4']},kinds=new Set(Object.keys(profiles));
const directory=id=>{if(!researchId(id))throw new AppError('INVALID');return '.observanda/release-input-media/'+id;};
const fileName=id=>{if(!researchId(id))throw new AppError('INVALID');return id+'.blob';};
const valid=row=>row&&researchId(row.id)&&kinds.has(row.kind)&&Number.isSafeInteger(row.size)&&row.size>=0&&/^[a-f0-9]{64}$/.test(row.sha256)&&row.extension===profiles[row.kind][0]&&row.mime===profiles[row.kind][1]&&typeof row.header==='string'&&/^(?:[a-f0-9]{2}){0,12}$/.test(row.header);
async function mediaDirectory(workspace,id,{missing=false}={}){
 let file=workspace.root;await assertRegular(file,{directory:true});
 for(const part of directory(id).split('/')){file=path.join(file,part);if(!await assertRegular(file,{directory:true,missing}))return null;}return file;
}
// A retained edition owns only the selected prepared assets. No source key or
// local path enters the manifest, and resumed rendering needs only its owner.
export async function retainPublicationMedia(workspace,jobId,assets,{signal}={}){
 await assertRegular(workspace.root,{directory:true});
 const root=await privateDirectory(workspace.root,directory(jobId)),retained=[],seen=new Set();
 try{for await(const asset of assets){
  signal?.throwIfAborted();if(!researchId(asset.id)||seen.has(asset.id)||!kinds.has(asset.kind))throw new AppError('INVALID');seen.add(asset.id);
  const file=path.join(root,fileName(asset.id)),bytes=asset.bytes;
  if(await assertRegular(file,{missing:true}))throw new AppError('PUBLICATION_IDENTITY');
  let header=Buffer.alloc(0);
  async function* input(){for await(const value of contentStream(bytes)){signal?.throwIfAborted();const chunk=Buffer.from(value);if(header.length<12)header=Buffer.concat([header,chunk.subarray(0,12-header.length)]);yield chunk;}}
  const saved=await writeContent(workspace,file,input(),{signal,expected:{size:contentSize(bytes),sha256:contentHash(bytes)}});
  if(saved.size!==contentSize(bytes)||saved.sha256!==contentHash(bytes))throw new AppError('MEDIA_INVALID');
  const row={id:asset.id,kind:asset.kind,extension:asset.extension,mime:asset.mime,...saved,header:header.toString('hex')};
  if(!valid(row))throw new AppError('MEDIA_INVALID');retained.push(row);
 }
 return retained;
 }catch(error){await removePublicationMedia(workspace,jobId);throw error;}
}
export function publicationInputMedia(workspace,source){
 if(source.version===6){
  let pending;const local=new MediaStore(workspace);
  return {async get(id,options={}){
   options.signal?.throwIfAborted();const input=await (pending??=openPublicationInput(workspace,source)),row=await input.get('retainedMedia',id);
   if(!row){const identity=await input.get('identities',id);if(identity?.origin.split('/')[1]==='media'&&identity.origin.split('/')[0]!==source.metadata.id)throw new AppError('JOB_DAMAGED');return local.get(id,options);}if(!valid(row)||row.id!==id)throw new AppError('JOB_DAMAGED');
   const root=await mediaDirectory(workspace,source.id),file=path.join(root,fileName(id));await assertRegular(file);options.signal?.throwIfAborted();
   return {id,kind:row.kind,extension:row.extension,mime:row.mime,bytes:new FileContent(workspace,file,row.size,row.sha256,Buffer.from(row.header,'hex'))};
  }};
 }
 const rows=source.retainedMedia??[];
 if(!Array.isArray(rows)||!rows.every(valid)||new Set(rows.map(row=>row.id)).size!==rows.length)throw new AppError('JOB_DAMAGED');
 const retained=new Map(rows.map(row=>[row.id,row])),foreign=new Set((source.records??[]).filter(row=>row.sourceWorkspaceId&&row.sourceWorkspaceId!==source.metadata.id).flatMap(row=>row.media.map(asset=>asset.id)));
 if([...foreign].some(id=>!retained.has(id)))throw new AppError('JOB_DAMAGED');
 const local=new MediaStore(workspace);
 return {async get(id,options){
  const row=retained.get(id);if(!row)return local.get(id,options);
  const root=await mediaDirectory(workspace,source.id),file=path.join(root,fileName(id));await assertRegular(file);
  return {id,kind:row.kind,extension:row.extension,mime:row.mime,bytes:new FileContent(workspace,file,row.size,row.sha256,Buffer.from(row.header,'hex'))};
 }};
}
export async function removePublicationMedia(workspace,jobId){
 const root=await mediaDirectory(workspace,jobId,{missing:true});if(!root)return;
 for(const name of await readdir(root)){
  if(!isStorageTemporary(name)&&(!name.endsWith('.blob')||!researchId(name.slice(0,-5))))throw new AppError('JOB_DAMAGED');
  const file=path.join(root,name);await assertRegular(file);await unlink(file);
 }
 await rmdir(root);
}
