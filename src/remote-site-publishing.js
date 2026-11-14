// Publishes a website into a host's web folder over a file transfer protocol
// (SFTP without a server shell, FTP or FTPS), as shared hosting provides it.
// The folder is the web root itself, so a release cannot be switched with one
// link: every new or changed file is first uploaded into this operation's own
// upload folder and only then renamed into place, so visitors never see a
// half-written file. Files are removed only when this destination's own record
// shows Observanda published them; nothing placed there by hand is touched.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {contentHash,contentSize} from './file-content.js';
import {verifyPublicationCandidate} from './retained-publication-files.js';
import {publicationText} from './web/publication-messages.js';
import {reviewedManifest} from './publication-live-budget.js';

export const REMOTE_OWNER_MARKER='.observanda-owner';
const UPLOAD_PREFIX='.observanda-upload-';
const BATCH=50;
const owner=value=>/^[a-f0-9-]{36}$/.test(value);
const hash=value=>/^[a-f0-9]{64}$/.test(value);
// Published names are relative POSIX paths without empty, dot or private parts.
export function remoteSitePath(value){
 if(typeof value!=='string'||!value||value.length>1024||value.startsWith('/')||/[\\\x00-\x1f]/.test(value))return false;
 const parts=value.split('/');return parts.every(part=>part&&part!=='.'&&part!=='..')&&parts[0]!==REMOTE_OWNER_MARKER&&!parts[0].startsWith(UPLOAD_PREFIX);
}
// The destination's record: every file this destination holds from Observanda,
// with the hash and size of the bytes that were confirmed in place.
export function validRemoteFiles(value){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([name,row])=>remoteSitePath(name)&&Array.isArray(row)&&row.length===2&&hash(row[0])&&Number.isSafeInteger(row[1])&&row[1]>=0);
}
const parents=name=>{const result=[];let parent=path.posix.dirname(name);while(parent!=='.'){result.unshift(parent);parent=path.posix.dirname(parent);}return result;};
const join=(root,name)=>root==='/'?'/'+name:root+'/'+name;

export async function deployRemoteSite(transport,c,candidate,ownerId,{journal={},save=async()=>{},guard=async()=>{},progress=async()=>{},signal,uploads,previousFiles=null,allowExisting=false,indexedFiles=true}={}){
 await verifyPublicationCandidate(candidate,{signal,remoteProgress:!!uploads});
 if(!owner(ownerId))throw new AppError('PUBLISH_CONFIG');
 const checkpoint=async()=>{await guard(journal.receipt?{phase:'receipt'}:undefined);signal?.throwIfAborted();await save(structuredClone(journal));};
 const step=async phase=>{await guard(phase?{phase}:undefined);signal?.throwIfAborted();};
 const report=key=>progress({stage:publicationText(key),done:journal.uploadedCount??0,total:candidate.files.size});
 if(!journal.nonce){
  if(previousFiles!==null&&!validRemoteFiles(previousFiles))throw new AppError('JOB_DAMAGED');
  Object.assign(journal,{nonce:randomUUID(),releaseId:candidate.id,total:candidate.files.size,phase:'claim',uploadedCount:0,activatedCount:0,remote:structuredClone(previousFiles??{}),lockAttempted:true});
  await checkpoint();
 }
 if(journal.releaseId!==candidate.id||!/^[a-f0-9-]{36}$/.test(journal.nonce)||!validRemoteFiles(journal.remote)||!['claim','upload','activate','remove','clean','done'].includes(journal.phase)||![journal.uploadedCount,journal.activatedCount].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=candidate.files.size))throw new AppError('JOB_DAMAGED');
 const root=c.directory,upload=join(root,UPLOAD_PREFIX+journal.nonce);
 // A file needs no transfer when this destination's record shows exactly
 // these bytes were confirmed in place by an earlier publication.
 const unchanged=(name,content)=>{const row=journal.remote[name];return !!row&&row[0]===contentHash(content)&&row[1]===contentSize(content);};
 await step('read');
 const session=await transport.open(c,{signal});
 try{
  if(journal.phase==='claim'){
   await report('remoteClaim');
   const marker=await session.readText(join(root,REMOTE_OWNER_MARKER),{missing:true});
   if(marker===null){
    await session.ensureDirectory(root);
    const entries=(await session.list(root)).filter(entry=>!entry.name.startsWith(UPLOAD_PREFIX));
    // An unclaimed folder that already holds files is used only when the
    // author chose to publish into it: same-named files are replaced, others kept.
    if(entries.length&&!allowExisting)throw new AppError('PUBLISH_OWNERSHIP');
    await step();await session.writeText(join(root,REMOTE_OWNER_MARKER),ownerId);
   }else if(marker.trim()!==ownerId)throw new AppError('PUBLISH_OWNERSHIP');
   // An interrupted earlier publication may have left its own upload folder.
   for(const entry of await session.list(root))if(entry.directory&&entry.name.startsWith(UPLOAD_PREFIX)&&entry.name!==UPLOAD_PREFIX+journal.nonce){await step();await session.removeTree(join(root,entry.name),{signal});}
   journal.phase='upload';await checkpoint();
  }
  if(journal.phase==='upload'){
   await report('remoteUpload');uploads?.start(journal.uploadedCount,candidate.files.size);
   const made=new Set();let batch=[],position=0;
   const flush=async()=>{
    if(!batch.length)return;
    const directories=[upload,...new Set(batch.flatMap(([name])=>parents(name).map(parent=>join(upload,parent))))].filter(directory=>!made.has(directory));
    await step();if(directories.length){await session.ensureDirectories(directories);for(const directory of directories)made.add(directory);}
    const items=batch.filter(([name,content])=>!unchanged(name,content));
    await step();if(items.length)await session.upload(items.map(([name,content])=>({content,target:join(upload,name)})),{signal});
    journal.uploadedCount+=batch.length;await checkpoint();
    uploads?.confirmed(batch.length,items.reduce((bytes,[,content])=>bytes+contentSize(content),0));batch=[];
   };
   for await(const item of candidate.files){
    if(position++<journal.uploadedCount)continue;
    if(!remoteSitePath(item[0]))throw new AppError('PUBLISH_CONFIG');
    batch.push(item);if(batch.length===BATCH)await flush();
   }
   await flush();
   if(journal.uploadedCount!==candidate.files.size)throw new AppError('JOB_DAMAGED');
   journal.phase='activate';await checkpoint();
  }
  if(journal.phase==='activate'){
   // From here the site changes: every write still passes today's consent.
   journal.pushAttempted=true;await checkpoint();uploads?.phase('remoteActivate');await report('remoteActivate');
   const made=new Set();let batch=[],position=0;
   const flush=async()=>{
    if(!batch.length)return;
    const directories=[...new Set(batch.flatMap(([name])=>parents(name).map(parent=>join(root,parent))))].filter(directory=>!made.has(directory));
    await step();if(directories.length){await session.ensureDirectories(directories);for(const directory of directories)made.add(directory);}
    const moves=batch.filter(([name,content])=>!unchanged(name,content));
    await step();if(moves.length)await session.replace(moves.map(([name])=>({from:join(upload,name),to:join(root,name)})),{signal});
    for(const [name,content] of moves)journal.remote[name]=[contentHash(content),contentSize(content)];
    journal.activatedCount+=batch.length;await checkpoint();batch=[];
   };
   for await(const item of candidate.files){if(position++<journal.activatedCount)continue;batch.push(item);if(batch.length===BATCH)await flush();}
   await flush();
   journal.phase='remove';await checkpoint();
  }
  if(journal.phase==='remove'){
   await report('remoteRemove');
   const gone=[];for(const name of Object.keys(journal.remote))if(!await candidate.files.has(name))gone.push(name);
   for(let at=0;at<gone.length;at+=BATCH){
    const part=gone.slice(at,at+BATCH);await step();await session.remove(part.map(name=>join(root,name)),{signal});
    for(const name of part)delete journal.remote[name];await checkpoint();
   }
   journal.phase='clean';await checkpoint();
  }
  if(journal.phase==='clean'){await step();await session.removeTree(upload,{signal});journal.phase='done';await checkpoint();}
  uploads?.verified(candidate.files.size);
  if(!journal.receipt){
   journal.commit=candidate.id;
   journal.receipt={releaseId:candidate.id,commit:candidate.id,previousRelease:null,at:new Date().toISOString(),status:'uploaded-remote',...await reviewedManifest(candidate)};
   await checkpoint();
  }
  journal.released=true;await checkpoint();await report('remoteConfirmed');
  return journal.receipt;
 }finally{await session.close();}
}
