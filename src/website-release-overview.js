import {AppError} from './errors.js';
import {contentHash} from './file-content.js';
import {LocalExport} from './local-export.js';
import {LocalExportManifest} from './local-export-manifest.js';
import {websitePublishTarget} from './website-publish-target.js';
import {remoteTransferStatus} from './website-remote-transfer.js';
import {readReleaseLedger} from './website-release-ledger.js';
import {readVersionIndex} from './website-version-retention.js';
import {isWithdrawalRelease} from './website-withdrawal-edition.js';

const sampleSize=40;
// Compare the saved edition with the inventory the destination acknowledged.
// Only paths and digests are compared; no published copy is fetched.
async function outstanding(candidate,delivered){
 const current=new Map();
 for(const [path,content] of candidate.files)current.set(path,contentHash(content));
 const counts={added:0,changed:0,removed:0,unchanged:0},samples={added:[],changed:[],removed:[]},seen=new Set();
 const note=(kind,path)=>{counts[kind]++;if(samples[kind]&&samples[kind].length<sampleSize)samples[kind].push(path);};
 for await(const row of delivered){
  seen.add(row.path);
  const sha=current.get(row.path);
  if(sha===undefined)note('removed',row.path);
  else note(sha===row.sha256?'unchanged':'changed',row.path);
 }
 for(const path of current.keys())if(!seen.has(path))note('added',path);
 for(const list of Object.values(samples))list.sort();
 return {counts,samples};
}
async function* legacyRows(rows){yield* rows;}

// One summary of what is saved, what was last delivered to the selected
// destination, what an update would change there and which earlier editions
// can be reopened from history.
export async function websiteReleaseOverview({store,siteId,expectedRevision,target,candidate,signal}){
 const metadata=target.workspace;
 const selected=await websitePublishTarget(metadata,async()=>{const saved=await target.read();return {...saved,transfer:await remoteTransferStatus(target,saved)};});
 signal?.throwIfAborted();
 const versions=await store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision);
  return new Set((await readVersionIndex(store,manifest)).entries.map(entry=>entry.id));
 },{signal});
 const ledger=(await readReleaseLedger(metadata)).map(entry=>({...entry,versionAvailable:!!entry.version&&versions.has(entry.version)}));
 let destination={kind:'choose'},delivered=null,transfer=null,pending=null,rows=null,key=null;
 if(selected.kind==='folder'){
  destination={kind:'folder',directory:selected.directory};key=selected.directory;
  const owner=await new LocalExport(metadata).delivered(selected.directory);
  if(owner?.releaseId){
   const entry=ledger.find(row=>row.releaseId===owner.releaseId&&row.destination.kind==='folder'&&row.destination.directory===selected.directory);
   delivered={releaseId:owner.releaseId,completedAt:entry?.completedAt??null,status:'verified'};
   rows=owner.files?new LocalExportManifest(metadata).entries(owner.files):legacyRows(owner.legacyFiles);
  }
  pending=owner?.pending??null;
 }else if(selected.kind==='remote'){
  const {receipt,config,destinationKey}=selected.destination;key=destinationKey;
  destination={kind:config.kind,config};transfer=selected.destination.transfer;
  if(receipt){
   delivered={releaseId:receipt.releaseId,completedAt:receipt.at??null,status:receipt.status??null,commit:receipt.commit??null,verification:receipt.verification??null};
   if(receipt.fileInventory)rows=new LocalExportManifest(metadata).entries(receipt.fileInventory);
  }
 }
 if(delivered)delivered.edition=isWithdrawalRelease(delivered.releaseId)?'withdrawal':'website';
 const changes=rows?await outstanding(candidate,rows):null;
 signal?.throwIfAborted();
 await store.checkRevision(siteId,expectedRevision);
 if(candidate.revision!==expectedRevision)throw new AppError('STALE');
 return {revision:expectedRevision,releaseId:candidate.id,files:candidate.files.size,destination,delivered,current:!!delivered&&delivered.releaseId===candidate.id,
  transfer,pending,changes,inventoryKnown:!!rows,
  releases:ledger.filter(entry=>key!==null&&(entry.destination.kind==='folder'?entry.destination.directory===key:entry.destination.key===key)).slice(0,20),
  otherReleases:ledger.filter(entry=>key===null||(entry.destination.kind==='folder'?entry.destination.directory!==key:entry.destination.key!==key)).length};
}
