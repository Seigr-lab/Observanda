import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';

// Completed deliveries of one website, newest first. Each row records which
// saved revision and history version produced the edition, so an author can
// return to that design. The rows contain no website documents.
const key='.observanda/website-releases.json';
export const maxReleaseEntries=50;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const absolute=value=>typeof value==='string'&&value.length<=4096&&(value.startsWith('/')||/^[A-Za-z]:[\\/]/.test(value)||value.startsWith('\\\\'));
const kinds=new Set(['folder','github','ssh']);
function valid(entry){
 if(!entry||typeof entry!=='object'||!hash(entry.releaseId)||!hash(entry.revision)||entry.version!==null&&!researchId(entry.version))return false;
 if(!['website','withdrawal'].includes(entry.edition)||!Number.isFinite(Date.parse(entry.completedAt)))return false;
 const destination=entry.destination;
 if(!destination||!kinds.has(destination.kind))return false;
 if(destination.kind==='folder')return absolute(destination.directory);
 return typeof destination.key==='string'&&destination.key.length<=200;
}
export async function readReleaseLedger(metadata){
 const text=await metadata.readMetadata(key,1024*1024);if(!text)return [];
 let value;try{value=JSON.parse(text);}catch{throw new AppError('JOB_DAMAGED');}
 if(value?.version!==1||!Array.isArray(value.entries)||value.entries.length>maxReleaseEntries||!value.entries.every(valid))throw new AppError('JOB_DAMAGED');
 return value.entries;
}
const sameDestination=(a,b)=>a.kind===b.kind&&(a.kind==='folder'?a.directory===b.directory:a.key===b.key);
// Recording is idempotent: resuming or settling an operation that was already
// recorded does not create another row.
export async function recordRelease(metadata,entry){
 if(!valid(entry))throw new AppError('INVALID');
 await metadata.withLock(async()=>{
  const entries=await readReleaseLedger(metadata);
  if(entries.some(row=>row.releaseId===entry.releaseId&&row.completedAt===entry.completedAt&&sameDestination(row.destination,entry.destination)))return;
  const next=[entry,...entries].slice(0,maxReleaseEntries);
  await metadata.writeMetadata(key,JSON.stringify({version:1,entries:next}));
 });
}
