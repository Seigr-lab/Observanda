import {openPublicationOutput} from './publication-output.js';
import {validWebsitePin} from './web/website-pin.js';
// A retained edition owns numbered blobs under its job and attempt identities.
import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {assertRegular,digest} from './storage.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('JOB_DAMAGED');};
export function publicationFiles(stored){
 if(![1,2].includes(stored?.version)||stored.version===2&&(!validWebsitePin(stored.websitePin)||stored.websitePin.websiteId!==stored.websiteId||stored.websitePin.researchSnapshotId!==stored.etag)||!researchId(stored.jobId)||!researchId(stored.attempt)||stored.reviewId!==digest(stored.jobId)||!revisionId(stored.id)||!Array.isArray(stored.files))damaged();
 const names=new Set();return stored.files.map(value=>{
  if(!value||value.index!==names.size||!Number.isSafeInteger(value.size)||value.size<0||!revisionId(value.sha256)||typeof value.name!=='string'||names.has(value.name)||!['text','binary','media'].includes(value.type))damaged();names.add(value.name);
  if(value.type==='media'&&(typeof value.header!=='string'||value.header.length>8192||value.header.length%2||!/^[a-f0-9]*$/.test(value.header)))damaged();
  return {file:Object.freeze(structuredClone(value)),relative:'.observanda/releases/'+stored.jobId+'/'+stored.attempt+'/'+value.index+'.blob'};
 });
}
// New editions enumerate their authenticated inventory without materializing
// every descriptor. The older array reader remains an explicit adapter.
export async function* publicationFileRows(workspace,stored,{offset=0,name,signal}={}){
 if(stored?.version!==3){const rows=publicationFiles(stored);if(!Number.isSafeInteger(offset)||offset<0||offset>rows.length)throw new AppError('INVALID');for(let at=offset;at<rows.length;at++){signal?.throwIfAborted();if(name===undefined||rows[at].file.name===name)yield rows[at];}return;}
 if(!validWebsitePin(stored.websitePin)||stored.websitePin.websiteId!==stored.websiteId||stored.websitePin.researchSnapshotId!==stored.etag||!researchId(stored.workspaceId)||!researchId(stored.jobId)||!researchId(stored.attempt)||stored.reviewId!==digest(stored.jobId)||!revisionId(stored.id))damaged();
 const output=await openPublicationOutput(workspace,stored,{signal}),count=output.count('files');if(!Number.isSafeInteger(offset)||offset<0||offset>count||name!==undefined&&(typeof name!=='string'||offset!==0))throw new AppError('INVALID');
 async function* selected(){if(name!==undefined){const value=await output.get('files',name,{signal});if(value!==null)yield {key:name,value};}else yield* output.items('files',{offset,signal});}
 for await(const {key,value} of selected()){
  signal?.throwIfAborted();
  if(!value||value.name!==key||!Number.isSafeInteger(value.index)||value.index<0||value.index>=count||!Number.isSafeInteger(value.size)||value.size<0||!revisionId(value.sha256)||!['text','binary','media'].includes(value.type))damaged();
  if(value.type==='media'&&(typeof value.header!=='string'||value.header.length>8192||value.header.length%2||!/^[a-f0-9]*$/.test(value.header)))damaged();
  if((await output.get('blobIndexes',String(value.index),{signal}))?.name!==key)damaged();
  yield {file:Object.freeze(structuredClone(value)),relative:'.observanda/releases/'+stored.jobId+'/'+stored.attempt+'/'+value.index+'.blob'};
 }
}
export async function publicationFileStamp(root,relative,{missing=false}={}){
 const parts=typeof relative==='string'?relative.split('/'):[];
 if(parts.length!==5||parts[0]!=='.observanda'||parts[1]!=='releases'||!researchId(parts[2])||!researchId(parts[3])||!/^(0|[1-9][0-9]*)\.blob$/.test(parts[4]))throw new AppError('UNSAFE');
 let file=root;await assertRegular(file,{directory:true});for(const part of parts.slice(0,-1)){file=path.join(file,part);await assertRegular(file,{directory:true});}file=path.join(file,parts.at(-1));let stat;
 try{stat=await lstat(file,{bigint:true});}catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}if(!stat.isFile()||stat.nlink!==1n)throw new AppError('UNSAFE');return Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(key=>[key,String(stat[key])]));
}
