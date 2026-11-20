import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';

// Completed deliveries of one website, newest first. Each row records which
// saved revision and history version produced the edition, so an author can
// return to that design. The rows contain no website documents.
const key='.observanda/website-releases.json';
export const maxReleaseEntries=50;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const absolute=value=>typeof value==='string'&&value.length<=4096&&(value.startsWith('/')||/^[A-Za-z]:[\\/]/.test(value)||value.startsWith('\\\\'));
const kinds=new Set(['folder','github','ssh','sftp','ftp']);
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
// Each released website edition can name the lab book records placed on it and
// the exact record revision each one showed. Run receipts cite these.
const recordsKey=releaseId=>'.observanda/website-release-records/'+releaseId+'.json';
export const maxReleaseRecords=100000;
const validRecord=row=>row&&typeof row==='object'&&Object.keys(row).sort().join()==='recordId,recordRevision,workspaceId'&&researchId(row.workspaceId)&&researchId(row.recordId)&&hash(row.recordRevision);
export function validReleaseRecords(records){
 return Array.isArray(records)&&records.length<=maxReleaseRecords&&records.every(validRecord)&&new Set(records.map(row=>row.workspaceId+'/'+row.recordId)).size===records.length;
}
export async function readReleaseRecords(metadata,releaseId){
 if(!hash(releaseId))throw new AppError('INVALID');
 const text=await metadata.readMetadata(recordsKey(releaseId),32*1024*1024);if(text===null)return null;
 let value;try{value=JSON.parse(text);}catch{throw new AppError('JOB_DAMAGED');}
 if(value?.version!==1||value.releaseId!==releaseId||!validReleaseRecords(value.records))throw new AppError('JOB_DAMAGED');
 return value.records;
}
// Recording is idempotent: resuming or settling an operation that was already
// recorded does not create another row. Records of releases that leave the
// ledger are removed with them.
export async function recordRelease(metadata,entry,{records=null}={}){
 if(!valid(entry)||records!==null&&(entry.edition!=='website'||!validReleaseRecords(records)))throw new AppError('INVALID');
 await metadata.withLock(async()=>{
  const entries=await readReleaseLedger(metadata);
  if(entries.some(row=>row.releaseId===entry.releaseId&&row.completedAt===entry.completedAt&&sameDestination(row.destination,entry.destination)))return;
  const next=[entry,...entries].slice(0,maxReleaseEntries),kept=new Set(next.map(row=>row.releaseId));
  if(records!==null)await metadata.writeMetadata(recordsKey(entry.releaseId),JSON.stringify({version:1,releaseId:entry.releaseId,records}));
  await metadata.writeMetadata(key,JSON.stringify({version:1,entries:next}));
  for(const row of entries)if(!kept.has(row.releaseId))await metadata.removeMetadata(recordsKey(row.releaseId));
 });
}
