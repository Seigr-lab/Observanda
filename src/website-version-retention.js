import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {readVersionJSON,snapshotFiles,snapshotIdentity,versionJSON,versionOwner,versionSnapshot} from './website-version-snapshots.js';

// Size limits apply to bytes held solely for history. Published files and
// editable drafts do not consume historical capacity while they are current.
export const maxVersions=32,maxNamed=8,retiredLimit=512*1024*1024;
const empty=()=>({format:1,entries:[],resources:[],held:[]});
export async function readVersionIndex(store,manifest){
 if(!manifest?.versionIndex)return empty();
 const index=await readVersionJSON(store,manifest.id,manifest.versionIndex);
 if(index?.format!==1||!Array.isArray(index.entries)||index.entries.length>maxVersions||!Array.isArray(index.resources)||!Array.isArray(index.held))throw new AppError('FORMAT');
 const valid=i=>Number.isInteger(i)&&i>=0&&i<index.resources.length;
 if(!index.held.every(valid)||index.entries.some(e=>!e||!Array.isArray(e.refs)||!e.refs.every(valid)||!e.snapshot)||index.resources.some(f=>!ownedVersionBlob(manifest.id,f.blob)||!Number.isSafeInteger(f.size)||f.size<0))throw new AppError('FORMAT');
 return index;
}
export function currentFileBlobs(manifest){
 return new Set([...(manifest?.files??[]),...(manifest?.editHistory?.files??[]),...(manifest?.publicPageFiles??[]).map(row=>row.file)].map(f=>f.blob));
}
export function archivedBlobs(index){
 return new Set([...index.entries.map(e=>e.snapshot.blob),...index.held.map(i=>index.resources[i].blob)]);
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function diffCount(former,next,key,identity){
 const original=new Map((former??[]).map(r=>[r[key],identity(r)]));
 let added=0,edited=0;
 for(const row of next){
  if(!original.has(row[key]))added++;
  else if(!same(original.get(row[key]),identity(row)))edited++;
  original.delete(row[key]);
 }
 return {added,edited,removed:original.size};
}
function changes(prior,next){
 const pages=diffCount(prior?.pages,next.pages,'path',({input,document,stamps,...state})=>state);
 const files=diffCount(prior?.assets,next.assets,'name',({sha256,draft})=>[sha256,!!draft]);
 return {pages,files,settings:Object.keys(next.settings).filter(name=>!same(prior?.settings[name],next.settings[name]))};
}
function boundedEntries(entries){
 if(entries.length<=maxVersions)return entries;
 const recent=entries.filter(e=>!e.label);
 const expired=new Set(recent.slice(Math.max(0,recent.length-(entries.length-maxVersions))).map(e=>e.id));
 return entries.filter(e=>!expired.has(e.id));
}
export function retainedVersionFiles(entries,resources,available,live,limit=retiredLimit){
 const kept=new Set(),used=new Set(),ordered=[...entries.filter(e=>e.label),...entries.filter(e=>!e.label)];
 let bytes=0;
 for(const template of [true,false])for(const entry of ordered)for(const i of entry.refs){
  if(kept.has(i))continue;
  const f=resources[i];used.add(i);
  if(f.blob.includes('/versions/files/')!==template||!available.has(f.blob))continue;
  const added=live.has(f.blob)?0:f.size;
  if(added>limit-bytes)continue;
  kept.add(i);bytes+=added;
 }
 return {kept,used,bytes};
}
export async function prepareVersionRetention(store,manifest,previous,{signal,label,restoredFrom,release,index:priorIndex,adopted=false}={}){
 if(label!==undefined&&(typeof label!=='string'||!label.trim()||label.trim().length>120))throw new AppError('INVALID');
 const old=priorIndex??await readVersionIndex(store,previous),latest=old.entries[0];
 if(label&&old.entries.filter(e=>e.label).length>=maxNamed)throw new AppError('LIMIT');
 const prior=latest?await readVersionJSON(store,manifest.id,latest.snapshot):null;
 const available=new Set([...currentFileBlobs(manifest),...currentFileBlobs(previous),...archivedBlobs(old)]);
 const next=await versionSnapshot(store,manifest,prior,available,signal),identity=snapshotIdentity(next);
 const newEntry=!latest||identity!==latest.identity||label||restoredFrom;
 const resources=old.resources.slice(),byBlob=new Map(resources.map((f,i)=>[f.blob,i]));
 let entries=old.entries;
 if(release!==undefined){
  if(!old.entries.some(e=>e.id===release&&e.label))throw new AppError('NOT_FOUND');
  entries=old.entries.map(e=>{
   if(e.id!==release)return e;
   const {label:removed,...ordinary}=e;return ordinary;
  });
 }
 if(newEntry){
  const snapshot=latest?.identity===identity&&same(next,prior)?latest.snapshot:await versionJSON(store,manifest.id,'snapshot.json',next,signal);
  const refs=[];
  for(const file of snapshotFiles(next).values()){
   let index=byBlob.get(file.blob);
   if(index===undefined){index=resources.length;byBlob.set(file.blob,index);resources.push({blob:file.blob,size:file.size});}
   refs.push(index);
  }
  const at=adopted&&Number.isFinite(Date.parse(manifest.updatedAt))?manifest.updatedAt:new Date().toISOString(),actor=adopted?{kind:'unrecorded'}:store.versionActor;
  const entry={id:randomUUID(),identity,snapshot,at,actor,changes:changes(prior,next),refs,...(label?{label:label.trim()}:{}),...(restoredFrom?{restoredFrom}:{})};
  entries=boundedEntries([entry,...entries]);
 }
 const live=currentFileBlobs(manifest),{kept,used}=retainedVersionFiles(entries,resources,available,live);
 const identifiers=[...used].sort((a,b)=>a-b),indexOf=new Map(identifiers.map((id,i)=>[id,i]));
 const index={format:1,entries:entries.map(e=>({...e,refs:e.refs.map(i=>indexOf.get(i))})),resources:identifiers.map(i=>resources[i]),held:[...kept].map(i=>indexOf.get(i)).sort((a,b)=>a-b)};
 const ref=!newEntry&&same(index,old)?previous.versionIndex:await versionJSON(store,manifest.id,'index.json',index,signal);
 const retained=archivedBlobs(index);retained.add(ref.blob);
 if(previous?.versionIndex)available.add(previous.versionIndex.blob);
 return {ref,retained,retired:[...available].filter(blob=>ownedVersionBlob(manifest.id,blob)&&!retained.has(blob)&&!live.has(blob))};
}
export function ownedVersionBlob(id,blob){
 const base=versionOwner(id).slice(0,-'/versions'.length)+'/';
 if(typeof blob!=='string'||!blob.startsWith(base))return false;
 return /^(?:(?:drafts|versions)\/)?files\/[0-9a-f]{64}\.[a-z0-9]{1,12}$/.test(blob.slice(base.length));
}
// Only an interrupted writer walks the history directory. The committed head
// decides reachability even when a process stopped after replacing that head.
export async function beginVersionWrite(store,scope,manifest,previous,signal){
 const owner=versionOwner(manifest.id),journal=owner+'/staging.json',site=owner.slice(0,-'/versions'.length);
 const interrupted=await store.control(journal,{missing:true});
 if(interrupted){
  const protectedFiles=currentFileBlobs(manifest);
  for(const blob of currentFileBlobs(previous))protectedFiles.add(blob);
  if(previous?.versionIndex){
   protectedFiles.add(previous.versionIndex.blob);
   for(const blob of archivedBlobs(await readVersionIndex(store,previous)))protectedFiles.add(blob);
  }
  const collect=async blob=>{if(ownedVersionBlob(manifest.id,blob)&&!protectedFiles.has(blob))await store.remove(blob);};
  if(interrupted.index){
   try{
    const old=await readVersionIndex(store,{id:manifest.id,versionIndex:interrupted.index});
    for(const blob of archivedBlobs(old))if(!blob.startsWith(owner+'/'))await collect(blob);
   }catch(error){if(error.code!=='NOT_FOUND')throw error;}
  }
  await scope.member(store.absolute(site+'/revisions/sentinel'),async directory=>{
   if(!directory)return;
   for await(const entry of directory.entries()){
    if(entry.directory||!/^[0-9a-f]{64}\.json$/.test(entry.name)||entry.name===previous?.revision+'.json')continue;
    const revisionFile=site+'/revisions/'+entry.name,abandoned=await store.control(revisionFile);
    store.validateManifest(abandoned,manifest.id);
    for(const blob of currentFileBlobs(abandoned))await collect(blob);
    await store.remove(revisionFile);
   }
  },{missing:true});
  await scope.member(store.absolute(owner+'/files/sentinel'),async directory=>{
   if(directory)for await(const entry of directory.entries())if(!entry.directory)await collect(owner+'/files/'+entry.name);
  },{missing:true});
 }
 const old=await readVersionIndex(store,previous);
 await store.writeControl(journal,{index:previous?.versionIndex??null},{signal});
 return {old,journal};
}
