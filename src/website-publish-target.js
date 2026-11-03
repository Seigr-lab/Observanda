import path from 'node:path';
import {AppError} from './errors.js';

const key='.observanda/website-update-target.json';
const absolute=value=>typeof value==='string'&&(path.posix.isAbsolute(value)||path.win32.isAbsolute(value));
function decode(value){
 let target;try{target=JSON.parse(value);}catch{throw new AppError('FORMAT');}
 if(!target||!['remote','folder'].includes(target.kind)||target.kind==='folder'&&!absolute(target.directory)||!Number.isFinite(Date.parse(target.selectedAt)))throw new AppError('FORMAT');
 return target;
}
export async function rememberPublishTarget(metadata,kind,directory,selectedAt=new Date().toISOString()){
 const target={kind,selectedAt,...(kind==='folder'?{directory}:{})};decode(JSON.stringify(target));
 await metadata.withLock(async()=>{
  const previous=await metadata.readMetadata(key,16384);
  if(previous&&Date.parse(decode(previous).selectedAt)>Date.parse(selectedAt))return;
  await metadata.writeMetadata(key,JSON.stringify(target));
 });
}
export async function websitePublishTarget(metadata,remote){
 const bytes=await metadata.readMetadata(key,16384),target=bytes&&decode(bytes);
 if(target?.kind==='folder')return {kind:'folder',directory:target.directory};
 const destination=await remote();
 if(destination.configured)return {kind:'remote',destination};
 // Earlier folder publications have owner receipts. Only a single completed
 // destination is unambiguous when the author has not selected a preference.
 let directory=null;
 for await(const name of metadata.metadataNames('.observanda/local-exports/owners')){
  if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
  const json=await metadata.readMetadata('.observanda/local-exports/owners/'+name,16*1024*1024);
  if(!json)continue;
  let owner;try{owner=JSON.parse(json);}catch{throw new AppError('FORMAT');}
  if(!owner?.releaseId||!absolute(owner.directory))continue;
  if(directory&&owner.directory!==directory)return {kind:'choose'};
  directory=owner.directory;
 }
 return directory?{kind:'folder',directory}:{kind:'choose'};
}
