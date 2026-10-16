import {retiredMediaContent} from './project-media-content.js';
import {validDownloadName,downloadInfo} from './web/website-file.js';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {unlink,readdir} from 'node:fs/promises';
import {AppError} from './errors.js';
import {MetadataFeed} from './metadata-feed.js';
import {privateDirectory,assertRegular} from './storage.js';
import {FileContent,writeContent,describeContent} from './file-content.js';
import {MediaStore} from './media.js';
import {MediaPolicy} from './media-policy.js';
import {researchId} from './web/research-reference.js';
const extensions={image:'png',audio:'wav',video:'mp4',file:'bin'};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export class MediaImports {
 constructor(workspace){this.workspace=workspace;this.media=new MediaStore(workspace);this.feed=new MetadataFeed(workspace,'.observanda/media-imports');}
 file(id){if(!researchId(id))throw new AppError('INVALID');return '.observanda/media-imports/'+id+'.json';}
 async directory(id){this.file(id);return privateDirectory(this.workspace.root,'.observanda/media/'+id);}
 async read(id){
  const raw=await this.workspace.readMetadata(this.file(id),8192);if(raw===null)throw new AppError('NOT_FOUND');
  let s;try{s=JSON.parse(raw);}catch{throw new AppError('MEDIA_INVALID');}
  if(s.id!==id||s.version!==1||!researchId(s.workspaceId)||!Object.hasOwn(extensions,s.kind)||!Number.isSafeInteger(s.size)||s.size<0||s.size===0&&s.kind!=='file'||!validDownloadName(s.name)||!Number.isFinite(Date.parse(s.createdAt))||s.source&&(!researchId(s.source.storageId)||s.source.size!==s.size||!hash(s.source.sha256)))throw new AppError('MEDIA_INVALID');
  return s;
 }
 async start({name,size,kind}){
  if(!validDownloadName(name)||!Number.isSafeInteger(size)||size<0||size===0&&kind!=='file'||!Object.hasOwn(extensions,kind))throw new AppError('MEDIA_INVALID');
  const policy=(await new MediaPolicy(this.workspace).read()).policy;
  if(policy.maxUploadBytes&&size>policy.maxUploadBytes)throw new AppError('MEDIA_LIMIT');
  const {metadata}=await this.workspace.outline(),s={version:1,id:randomUUID(),workspaceId:metadata.id,name,size,kind,createdAt:new Date().toISOString(),source:null};
  await this.workspace.withLock(async()=>{await this.feed.ensureLocked();await this.workspace.writeMetadata(this.file(s.id),JSON.stringify(s));await this.feed.putLocked(s);});return s;
 }
 async receiving(id,operation){
  this.file(id);const db=await this.workspace.openCatalogue();
  try{
   if(!(await db.get('SELECT pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1,0)) AS locked',db.id+':media-receive:'+id)).locked)throw new AppError('LOCKED');
   return await operation(async()=>{await db.get('SELECT 1 AS alive');});
  }finally{await db.close();}
 }
 async recoverReceived(id,known=null){
  this.file(id);const session=known??await this.read(id);if(session.source)return session;
  // No transfer has reached disk yet. Merely browsing must not create storage
  // directories or acquire a per-upload database lock for each empty intent.
  if(!await assertRegular(this.workspace.metadataPath('.observanda/media/'+id),{directory:true,missing:true}))return session;
  return this.receiving(id,async check=>{
   const s=await this.read(id);if(s.source)return s;const directory=await this.directory(id);
   for(const name of (await readdir(directory)).sort()){
    const file=path.join(directory,name);
    if(/^\.stream-[a-f0-9-]{36}$/.test(name)){await assertRegular(file);await unlink(file);continue;}
    const match=/^([a-f0-9-]{36})\.original$/.exec(name);if(!match)continue;
    await assertRegular(file);const content=await describeContent(this.workspace,file);
    if(content.size!==s.size){await unlink(file);continue;}
    await check();return this.workspace.withLock(async()=>{
     const current=await this.read(id);if(!current.source){current.source={storageId:match[1],size:content.size,sha256:content.sha256};await this.workspace.writeMetadata(this.file(id),JSON.stringify(current));}return current;
    });
   }
   return s;
  });
 }
 async receive(id,input,options={}){
  await this.recoverReceived(id);
  return this.receiving(id,check=>this.receiveLocked(id,input,{...options,check}));
 }
 async receiveLocked(id,input,{signal,check}={}){
  const session=await this.read(id);if(session.source){await (await this.original(id)).content.verify();return session;}
  const policy=(await new MediaPolicy(this.workspace).read()).policy;
  if(policy.maxUploadBytes&&session.size>policy.maxUploadBytes)throw new AppError('MEDIA_LIMIT');
  const directory=await this.directory(id),storageId=randomUUID(),file=path.join(directory,storageId+'.original');
  let written=false;
  try{
   const source=await writeContent(this.workspace,file,Buffer.isBuffer(input)?[input]:input,{maxBytes:session.size,reserveBytes:policy.reserveBytes,signal});written=true;
   if(source.size!==session.size){await unlink(file);written=false;throw new AppError('MATERIAL_INCOMPLETE');}signal?.throwIfAborted();await check();
   return await this.workspace.withLock(async()=>{
    const current=await this.read(id);
    if(current.source){if(current.source.sha256!==source.sha256)throw new AppError('JOB_CHANGED');return current;}
    current.source={storageId,...source};await this.workspace.writeMetadata(this.file(id),JSON.stringify(current));return current;
   });
  }finally{
   // An uncertain database outcome must never delete a possibly committed original.
   if(written){const current=await this.read(id);if(current.source&&current.source.storageId!==storageId&&current.source.sha256===(await describeContent(this.workspace,file)).sha256)await unlink(file);}
  }
 }
 async original(id){
  const session=await this.read(id);if(!session.source)throw new AppError('MATERIAL_INCOMPLETE');
  let directory=this.workspace.root;
  for(const part of ['.observanda','media',id]){directory=path.join(directory,part);await assertRegular(directory,{directory:true,missing:true});}
  const file=path.join(directory,session.source.storageId+'.original'),relative=path.relative(this.workspace.root,file).split(path.sep).join('/'),retired=await retiredMediaContent(this.workspace,relative,session.source.size,session.source.sha256);if(retired)return {session,content:retired};await assertRegular(file);
  return {session,content:new FileContent(this.workspace,file,session.source.size,session.source.sha256)};
 }
 async page(options){
  await this.feed.ensure();
  const page=await this.workspace.catalogue(async()=>{const page=await this.feed.page(options),items=[];for(const entry of page.items)items.push(await this.read(entry.id));return {...page,items};});
  for(let i=0;i<page.items.length;i++){const session=page.items[i];if(!session.source)try{page.items[i]=await this.recoverReceived(session.id,session);}catch(error){if(error.code!=='LOCKED')throw error;}}
  return page;
 }
 async list(){const items=[];let cursor=null;do{const page=await this.page({cursor});items.push(...page.items);cursor=page.next;}while(cursor);return items;}
 async prepare(id,storageId,options){
  if(!researchId(storageId))throw new AppError('INVALID');const {session,content}=await this.original(id);
  if(session.kind==='file'){await content.verify({signal:options?.signal,onProgress:(done,total)=>options?.progress?.({stage:'Checking original file',done,total,unit:'bytes'})});return {id,kind:'file',name:session.name,extension:'bin',mime:'application/octet-stream',bytes:content.size,sha256:content.sha256,originalBytes:content.size,originalSha256:content.sha256,storageId:session.source.storageId};}
  const output=path.join(await this.directory(id),storageId+'.public.'+extensions[session.kind]);
  const metadata=await this.media.prepare(content,session.kind,id,output,options);
  return {...metadata,storageId};
 }
 async commit(id,prepared){
  const s=await this.read(id);
  if(prepared.id!==id||prepared.kind!==s.kind||!researchId(prepared.storageId)||prepared.originalSha256!==s.source?.sha256||prepared.originalBytes!==s.size)throw new AppError('JOB_CHANGED');
  if(s.kind==='file'&&(prepared.storageId!==s.source.storageId||prepared.name!==s.name||prepared.bytes!==s.size||prepared.sha256!==s.source.sha256||prepared.extension!=='bin'||prepared.mime!=='application/octet-stream'))throw new AppError('JOB_CHANGED');
  await this.workspace.writeMetadata('.observanda/media-assets/'+id+'.json',JSON.stringify(prepared));
  return {id,kind:s.kind,...(s.kind==='file'?downloadInfo(prepared):{})};
 }
 async clean(id,{only}={}){
  if(only!==undefined&&!researchId(only))throw new AppError('INVALID');
  const raw=await this.workspace.readMetadata('.observanda/media-assets/'+id+'.json',4096),retained=raw?JSON.parse(raw).storageId:null,directory=await this.directory(id);
  for(const name of await readdir(directory)){
   const match=/^([a-f0-9-]{36})\.public\.(png|wav|mp4)$/.exec(name);
   const temporary=!only&&/^\.stream-[a-f0-9-]{36}$/.test(name);
   if(!match&&!temporary)continue;
   if(match&&(match[1]===retained||only&&match[1]!==only))continue;
   const file=path.join(directory,name);await assertRegular(file);await unlink(file);
  }
 }
}
export function mediaJobDefinitions(workspace,queue){
 const imports=new MediaImports(workspace);
 return {'media.prepare':{
  authorize:async job=>{const s=await imports.read(job.id);if(job.input.importId!==s.id||job.scope!==s.workspaceId||job.input.size!==s.size||!s.source)throw new AppError('JOB_CHANGED');await workspace.requireStorageKey();},
  prepare:async(job,options)=>{await queue().transaction(async()=>{await queue().held(job.id,job.lease.token);await imports.clean(job.id);});return imports.prepare(job.id,job.lease.token,options);},
  commit:(job,prepared)=>imports.commit(job.id,prepared),
  discard:job=>imports.clean(job.id,{only:job.lease.token})
 }};
}
