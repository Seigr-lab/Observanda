import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {AppError} from './errors.js';
import {WebsiteFileContent} from './website-file-store.js';
import {websiteFileName,websiteHTMLByteLimit,draftWebsiteMediaReferences} from './website-file-policy.js';
import {websiteCSSByteLimit} from './web/website-css-urls.js';
import {researchId} from './web/research-reference.js';
import {privateInputContent,recordingDraftForm} from './website-recovery-input.js';
import {editHistory} from './website-edit-history.js';
import {websiteRecordingKind} from './website-recordings.js';
import {isStorageTemporary} from './storage-temporary.js';

const root='.observanda/website-files',catalogue=root+'/recovery-order';
const digest=value=>createHash('sha256').update(value).digest('hex');
const revision=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const fail=(code='INVALID')=>{throw new AppError(code);};
const pictureName=name=>/^pictures\/[a-f0-9-]{36}\.png$/.test(name);
const owner=(site,id)=>root+'/sites/'+site+'/recovery/'+id;
const pageIndex=(site,page)=>root+'/sites/'+site+'/recovery-pages/'+digest(page);
const orderName=r=>String(9999999999999-Date.parse(r.updatedAt)).padStart(13,'0')+'-'+r.id+'.json';
const orderRef=r=>({siteId:r.siteId,path:r.path,id:r.id,revision:r.revision});
const pendingRoot=root+'/recovery-pending';
const pendingName=(site,id)=>pendingRoot+'/'+digest(site+'/'+id)+'.json';
function pageKey(site,path,id){
 if(!researchId(site)||id!==undefined&&!researchId(id))fail();
 websiteFileName(path);if(!path.endsWith('.html'))fail();
}
function selection(value){
 if(value==null)return null;
 const point=p=>p&&Number.isSafeInteger(p.offset)&&p.offset>=0&&Array.isArray(p.path)&&p.path.length<=256&&p.path.every(i=>Number.isSafeInteger(i)&&i>=0);
 if(!point(value.anchor)||!point(value.focus))fail();
 return {anchor:{path:value.anchor.path,offset:value.anchor.offset},focus:{path:value.focus.path,offset:value.focus.offset}};
}
function fileValid(file,directory){
 return file&&typeof file.name==='string'&&Number.isSafeInteger(file.size)&&file.size>=0&&revision(file.sha256)&&file.blob===directory+'/files/'+file.sha256+file.name.slice(file.name.lastIndexOf('.'));
}
async function record(store,site,path,id,{collecting=false}={}){
 pageKey(site,path,id);if(!researchId(id))fail();const directory=owner(site,id);
 const r=await store.control(directory+'/head.json',{missing:true});if(!r)return null;
 if(!collecting&&(await store.control(directory+'/staging.json',{missing:true}))?.discard===r.revision)return null;
 if(!researchId(r.operationId)||r.version!==1||r.workspaceId!==store.workspace.vault.id||r.id!==id||r.siteId!==site||r.path!==path)fail('FORMAT');
 if(![r.revision,r.sourceStamp,r.surfaceStamp,r.baseRevision].every(revision)||!Number.isSafeInteger(Date.parse(r.updatedAt)))fail('FORMAT');
 if(r.html?.name!=='draft.html'||r.css?.name!=='draft.css'||!fileValid(r.html,directory)||!fileValid(r.css,directory))fail('FORMAT');
 if(!Array.isArray(r.pictures)||!r.pictures.every(f=>fileValid(f,directory)&&pictureName(f.name)))fail('FORMAT');
 if(!Array.isArray(r.recordings)||!r.recordings.every(f=>fileValid(f,directory)&&websiteRecordingKind(f)))fail('FORMAT');
 if(!Array.isArray(r.required)||!r.required.every(name=>typeof name==='string'&&/^(pictures|recordings)\//.test(name))||![null,'html','css'].includes(r.sourceOnly))fail('FORMAT');
 if(!Array.isArray(r.inputs)||r.inputs.length>2)fail('FORMAT');
 const inputDirectory=directory+'/inputs/';
 for(const file of r.inputs){
  const formFile=r.recordingForm?.files?.[file?.slot];
  if(!['vtt','upload'].includes(file?.slot)||!researchId(file.id)||!revision(file.sha256)||typeof file.blob!=='string'||!file.blob.startsWith(inputDirectory))fail('FORMAT');
  if(!/^[a-f0-9-]{36}\.bin$/.test(file.blob.slice(inputDirectory.length))||!formFile||file.size!==formFile.size||file.id!==formFile.id)fail('FORMAT');
 }
 return r;
}
function summary(store,manifest,r){
 const found=manifest?.pages.find(p=>p.path===r.path);
 const sameGrants=!!found&&store.sourceStamp(manifest,r.path)===r.sourceStamp;
 const sameBase=sameGrants&&(manifest.revision===r.baseRevision||store.surfaceStamp(manifest,r.path)===r.surfaceStamp);
 const state=!manifest?'access-changed':!found?'missing':!sameGrants?'access-changed':sameBase?'ready':'conflict';
 return {surface:'website',id:r.id,owner:{workspaceId:r.workspaceId,websiteId:r.siteId},documentKey:r.path,revision:r.revision,baseRevision:r.baseRevision,updatedAt:r.updatedAt,state,capabilities:{recover:sameBase,compare:sameGrants,discard:true},...(sameGrants?{title:found.title}:{})};
}
async function removeIfUnused(store,old,next){
 if(!old)return;const used=new Set(next?[next.html,next.css,...next.pictures,...next.recordings,...next.inputs].map(f=>f.blob):[]);
 for(const file of [old.html,old.css,...old.pictures,...old.recordings,...old.inputs])if(!used.has(file.blob))await store.remove(file.blob);
}
function checkPin(r,pin){if(!r||r.revision!==pin)fail('DRAFT_CHANGED');}
async function admissibleManifest(store,site){
 try{return await store.current(site);}catch(error){if(error.code==='CONFLICT'||error.code==='NOT_FOUND')return null;throw error;}
}
export function registerRecoveryWrite(store,site,path,id,signal){
 pageKey(site,path,id);if(!researchId(id))fail();
 return store.scope(()=>store.writeControl(pendingName(site,id),{site,path,id},{signal}),{write:true,signal});
}
async function withIdleInputs(store,scope,site,id,task){
 const file=store.absolute(owner(site,id)+'/inputs/writer');
 return scope.member(file,async(parent,name)=>{
  if(!parent)return task();let lease;
  try{lease=await parent.lease(name);}catch(error){if(error.code==='EBUSY'||error.code==='LOCKED')return;throw error;}
  try{return await task();}finally{await lease.close();}
 },{missing:true});
}
async function collectFiles(store,scope,site,path,id){
 const directory=owner(site,id),stage=await store.control(directory+'/staging.json',{missing:true});
 let r=await record(store,site,path,id,{collecting:true});
 if(r&&stage?.discard===r.revision){await store.remove(directory+'/head.json');r=null;}
 const admitted=new Set(r?[r.html,r.css,...r.pictures,...r.recordings,...r.inputs].map(f=>f.blob):[]);
 for(const child of ['files','inputs']){
  const selected=directory+'/'+child;
  await scope.member(store.absolute(selected+'/sentinel'),async parent=>{
   if(!parent)return;
   for await(const item of parent.entries()){
    if(item.directory||item.name==='writer')continue;
    const managed=child==='inputs'?/^[a-f0-9-]{36}\.bin$/:/^[a-f0-9]{64}\.(png|wav|mp4|vtt|html|css)$/;
    if(!managed.test(item.name)&&!isStorageTemporary(item.name)||admitted.has(selected+'/'+item.name))continue;
    const stat=await parent.stat(item.name);await parent.remove(item.name,{identity:stat.identity});
   }
  },{missing:true});
 }
 for(const name of new Set([stage?.order,stage?.previous])){
  if(typeof name!=='string'||!/^\d{13}-[a-f0-9-]{36}\.json$/.test(name)||r&&name===orderName(r))continue;
  await store.remove(catalogue+'/'+name);await store.remove(pageIndex(site,path)+'/'+name);
 }
 await store.remove(directory+'/staging.json');await store.remove(pendingName(site,id));
}
export function finishRecoveryInputs(store,site,path,id){
 // The input writer still holds its native lease; the final head is the
 // authority if storage failed after atomically committing a receipt.
 return store.scope(scope=>collectFiles(store,scope,site,path,id),{write:true});
}
async function collectInterrupted(store,signal){
 const batch=await store.scope(()=>store.names(pendingRoot,{limit:12,directories:false}),{signal});
 if(!batch.items.length)return;
 await store.scope(async scope=>{
  for(const member of batch.items){
   const pending=await store.control(pendingRoot+'/'+member,{missing:true});if(!pending)continue;
   const {site,path,id}=pending;pageKey(site,path,id);if(!researchId(id)||pendingName(site,id)!==pendingRoot+'/'+member)fail('FORMAT');
   await withIdleInputs(store,scope,site,id,()=>collectFiles(store,scope,site,path,id));
  }
 },{write:true,signal});
}
const receipt=(store,manifest,r)=>({...summary(store,manifest,r),operationId:r.operationId,pictures:r.pictures.map(f=>f.name),recordings:r.recordings.map(f=>f.name),inputs:r.inputs.map(f=>f.id)});

export async function saveWebsiteRecovery(store,site,{id,path,baseRevision,expectedDraftRevision=null,operationId,historyKey,html,css,sourceKind=null,recordingForm:inputForm,uploadedInputs=[],bookmark,signal,receivePictures}){
 pageKey(site,path,id);if(!researchId(id)||!researchId(operationId)||!revision(baseRevision)||expectedDraftRevision!==null&&!revision(expectedDraftRevision)||![null,'html','css'].includes(sourceKind))fail();
 if(typeof html!=='string'||typeof css!=='string'||Buffer.byteLength(html)>websiteHTMLByteLimit||Buffer.byteLength(css)>websiteCSSByteLimit)fail('LIMIT');
 const selected=selection(bookmark),recordingForm=recordingDraftForm(inputForm);
 return store.scope(async scope=>{
  const manifest=await store.current(site,baseRevision),old=await record(store,site,path,id),directory=owner(site,id);
  const former=manifest.pages.find(p=>p.path===path);if(!former)fail('NOT_FOUND');
  let sourceOnly=null,used,recordings=[];
  try{
   const inspected=await store.inspectPageSource(manifest,path,html,css,signal);
   used=new Set([...inspected.htmlPictures,...inspected.cssPictures]);recordings=[...inspected.recordingNames];
  }catch(error){
   if(!sourceKind||!['INVALID','CONFLICT'].includes(error.code))throw error;
   // Partially written source is private text. It may only be compared as
   // text or reopened in the code field until ordinary admission succeeds.
   sourceOnly=sourceKind;
   const references=draftWebsiteMediaReferences(html,css,path,store.site(manifest,former).cssPath);
   used=references.pictures;recordings=[...references.recordings];
  }
  const files=new Map(manifest.files.map(f=>[f.name,f]));
  const pictures=new Map((old?.pictures??[]).filter(p=>used.has(p.name)&&!files.has(p.name)).map(p=>[p.name,p]));
  const ownedRecordings=new Map((old?.recordings??[]).filter(f=>recordings.includes(f.name)&&!files.has(f.name)).map(f=>[f.name,f]));
  const historical=new Map(editHistory(manifest,historyKey,path).map(f=>[f.name,f]));
  const retry=old?.operationId===operationId;
  if(!retry&&(old?.revision??null)!==expectedDraftRevision)fail('DRAFT_CHANGED');
  if(old&&old.baseRevision!==baseRevision&&summary(store,manifest,old).state!=='ready')fail('DRAFT_CHANGED');
  const inputs=Object.entries(recordingForm?.files??{}).map(([slot,selected])=>{
   const file=[...uploadedInputs,...(old?.inputs??[])].find(file=>file.id===selected.id&&file.slot===slot&&file.name===selected.name&&file.size===selected.size);
   if(!file)fail('MATERIAL_MISSING');return file;
  });
  // A process can die between writing a private blob and publishing its head.
  // Clean the interrupted draft owner before admitting another write.
  const stage=directory+'/staging.json',interrupted=await store.control(stage,{missing:true});
  if(interrupted){
   const retained=new Set(old?[old.html,old.css,...old.pictures,...old.recordings].map(f=>f.blob):[]);
   await scope.member(store.absolute(directory+'/files/sentinel'),async parent=>{
    if(!parent)return;for await(const item of parent.entries()){
     if(item.directory||!/^\w{64}\.(png|css|html|wav|mp4|vtt)$/.test(item.name)||retained.has(directory+'/files/'+item.name))continue;
     const stat=await parent.stat(item.name);await parent.remove(item.name,{identity:stat.identity});
    }
   },{missing:true});
   if(typeof interrupted.order==='string'&&/^\d{13}-[a-f0-9-]{36}\.json$/.test(interrupted.order)&&interrupted.order!==(old&&orderName(old))){await store.remove(catalogue+'/'+interrupted.order);await store.remove(pageIndex(site,path)+'/'+interrupted.order);}
  }
  const time=new Date(Math.max(Date.now(),old?Date.parse(old.updatedAt)+1:0)).toISOString();
  const recordBase={version:1,workspaceId:store.workspace.vault.id,siteId:site,path,id,baseRevision,sourceStamp:store.sourceStamp(manifest,path),surfaceStamp:store.surfaceStamp(manifest,path),sourceOnly,recordingForm,bookmark:selected};
  const next={...recordBase,updatedAt:time,operationId,inputs};
  await registerRecoveryWrite(store,site,path,id,signal);
  await store.writeControl(stage,{order:orderName(next),previous:old?orderName(old):null},{signal});
  if(receivePictures)for await(const {name,bytes} of receivePictures()){
   if(!pictureName(name)||!used.has(name)||files.has(name))fail();
   const existing=pictures.get(name);
   if(existing&&existing.sha256!==digest(bytes))fail();
   pictures.set(name,existing??await store.descriptor(name,bytes,{owner:directory,signal}));
  }
  const required=[];
  for(const name of [...used,...recordings]){
   const file=files.get(name),retired=historical.get(name);
   if(file){
    if(file.draft&&!former.draft){if(sourceOnly)continue;fail('MATERIAL_MISSING');}
    required.push(name);continue;
   }
   if(pictures.has(name)||ownedRecordings.has(name))continue;
   if(!retired){if(!sourceOnly)fail('MATERIAL_MISSING');continue;}
   const content=new WebsiteFileContent(store,site,manifest.revision,retired),copy=await store.descriptor(name,{bytes:content,contentType:retired.contentType},{owner:directory,signal});
   if(websiteRecordingKind(retired))ownedRecordings.set(name,{...copy,recording:true,...(retired.label?{label:retired.label}:{})});else pictures.set(name,copy);
  }
  next.html=await store.descriptor('draft.html',html,{owner:directory,signal});next.css=await store.descriptor('draft.css',css,{owner:directory,signal});
  next.pictures=[...pictures.values()].sort((a,b)=>a.name.localeCompare(b.name));next.recordings=[...ownedRecordings.values()].sort((a,b)=>a.name.localeCompare(b.name));next.required=required;
  next.revision=digest(JSON.stringify([operationId,recordBase,next.html.sha256,next.css.sha256,[...next.pictures,...next.recordings].map(p=>[p.name,p.sha256]),inputs.map(f=>f.sha256)]));
  if(retry){
   if(next.revision!==old.revision)fail('DRAFT_CHANGED');
   await store.remove(stage);await withIdleInputs(store,scope,site,id,()=>store.remove(pendingName(site,id)));return receipt(store,manifest,old);
  }
  // Index rows are hints. Only the final, atomic head authenticates a receipt.
  await store.writeControl(catalogue+'/'+orderName(next),orderRef(next),{signal});
  await store.writeControl(pageIndex(site,path)+'/'+orderName(next),orderRef(next),{signal});
  await store.writeControl(directory+'/head.json',next,{signal});
  if(old){await store.remove(catalogue+'/'+orderName(old));await store.remove(pageIndex(site,path)+'/'+orderName(old));}
  await removeIfUnused(store,old,next);await store.remove(stage);await withIdleInputs(store,scope,site,id,()=>store.remove(pendingName(site,id)));
  return receipt(store,manifest,next);
 },{write:true,signal});
}

function cursor(store,scope,limit,after){
 const payload=Buffer.from(JSON.stringify([store.workspace.vault.id,scope,limit,after])).toString('base64url');
 return payload+'.'+createHmac('sha256',store.workspace.vault.key).update(payload).digest('base64url');
}
function readCursor(store,scope,limit,value){
 if(value==null)return null;
 if(typeof value!=='string'||value.length>2048)fail();
 try{
  const [payload]=value.split('.'),[workspace,kind,size,after]=JSON.parse(Buffer.from(payload,'base64url'));
  const expected=Buffer.from(cursor(store,scope,limit,after)),actual=Buffer.from(value);
  if(workspace!==store.workspace.vault.id||kind!==scope||size!==limit||!/^\d{13}-[a-f0-9-]{36}\.json$/.test(after)||expected.length!==actual.length||!timingSafeEqual(expected,actual))fail();
  return after;
 }catch{fail();}
}
async function list(store,directory,{site,path,limit=25,cursor:token,signal}){
 if(!Number.isInteger(limit)||limit<1||limit>100)fail();
 try{await collectInterrupted(store,signal);}catch(error){
  // Existing acknowledgements remain readable when the volume refuses the
  // optional collection pass. In-progress discard tombstones still apply.
  if(!['EROFS','ENOSPC','EACCES','EBUSY','IO','LOCKED','STORAGE_FULL'].includes(error.code))throw error;
 }
 return store.scope(async()=>{
  const items=[],sites=new Map();let after=readCursor(store,directory,limit,token),last=null;
  do{
   const batch=await store.names(directory,{after,limit:Math.min(100,limit+1),directories:false});after=batch.next;
   for(const name of batch.items){
    signal?.throwIfAborted();
    const ref=await store.control(directory+'/'+name,{missing:true});if(!ref)continue;
    if(site!==undefined&&(ref.siteId!==site||ref.path!==path))fail('FORMAT');
    const r=await record(store,ref.siteId,ref.path,ref.id);if(!r||r.revision!==ref.revision||orderName(r)!==name)continue;
    if(items.length===limit)return {items,next:cursor(store,directory,limit,last)};
    if(!sites.has(r.siteId))sites.set(r.siteId,await admissibleManifest(store,r.siteId));
    items.push(summary(store,sites.get(r.siteId),r));last=name;
   }
  }while(after);
  return {items,next:null};
 },{signal});
}
export function inspectWebsiteRecovery(store,site,{path,limit,cursor,signal}){
 pageKey(site,path);return list(store,pageIndex(site,path),{site,path,limit,cursor,signal});
}
export function listWebsiteRecovery(store,{limit,cursor,signal}={}){
 return list(store,catalogue,{limit,cursor,signal});
}
export function readWebsiteRecovery(store,site,{id,path,revision:pin,compare=false,signal}){
 return store.scope(async scope=>{
  const manifest=await admissibleManifest(store,site),r=await record(store,site,path,id);checkPin(r,pin);const row=summary(store,manifest,r);
  if(!row.capabilities[compare?'compare':'recover'])return {summary:row};
  const files=new Map(manifest.files.map(f=>[f.name,f]));
  for(const file of [r.html,r.css,...r.pictures,...r.recordings,...r.inputs,...r.required.map(name=>files.get(name))])if(!file||!await scope.stat(store.absolute(file.blob),{missing:true})){
   return {summary:{...row,state:'missing-media',capabilities:{recover:false,compare:false,discard:true}}};
  }
  const html=await store.readText(r.html,{signal}),css=await store.readText(r.css,{signal});
  let saved;
  if(compare){const current=await store.present(manifest,path,{signal});saved={revision:manifest.revision,html:current.html,css:current.css};}
  await store.current(site,manifest.revision);checkPin(await record(store,site,path,id),pin);
  return {summary:row,html,css,sourceOnly:r.sourceOnly,recordingForm:r.recordingForm,bookmark:r.bookmark,pictures:r.pictures.map(f=>({name:f.name,size:f.size})),recordings:r.recordings.map(f=>f.name),...(saved?{saved}:{})};
 },{signal});
}
export function websiteRecoveryInput(store,site,{id,path,revision:pin,slot,inputId,signal}){
 return store.scope(async()=>{
  const manifest=await store.current(site),r=await record(store,site,path,id);checkPin(r,pin);
  if(!summary(store,manifest,r).capabilities.recover)fail('DRAFT_CHANGED');
  const file=r.inputs.find(input=>input.id===inputId&&input.slot===slot);if(!file)fail('NOT_FOUND');
  return privateInputContent(store,file);
 },{signal});
}
export function websiteRecoveryResource(store,site,{path,id,revision:pin,name,assetStamp,signal}){
 return store.scope(async()=>{
  const manifest=await store.current(site),r=await record(store,site,path,id);checkPin(r,pin);
  const file=r.pictures.find(f=>f.name===name)??r.recordings.find(f=>f.name===name);
  if(!file||!summary(store,manifest,r).capabilities.recover||store.assetStamp(manifest,path)!==assetStamp)fail('NOT_FOUND');
  return {contentType:file.contentType,content:new WebsiteFileContent(store,site,manifest.revision,file)};
 },{signal});
}
// Read the selected draft inside the same file-store writer as the ordinary
// Save. Only referenced, author-owned pictures can become site files.
export async function recoveryAssets(store,manifest,path,ref,pictureNames,recordingNames){
 const r=await record(store,manifest.id,path,ref?.id);checkPin(r,ref?.revision);
 if(!summary(store,manifest,r).capabilities.recover)fail('DRAFT_CHANGED');
 const live=new Set(manifest.files.map(f=>f.name));
 const copies=(files,used)=>files.filter(f=>used.has(f.name)&&!live.has(f.name)).map(f=>({
  name:f.name,bytes:new WebsiteFileContent(store,manifest.id,manifest.revision,f),contentType:f.contentType,label:f.label
 }));
 return {pictures:copies(r.pictures,pictureNames),recordings:copies(r.recordings,recordingNames)};
}
export function discardWebsiteRecovery(store,site,{id,path,revision:pin,signal}){
 return store.scope(async scope=>{
  const r=await record(store,site,path,id);if(!r)return {discarded:true};checkPin(r,pin);
  await registerRecoveryWrite(store,site,path,id,signal);
  await store.writeControl(owner(site,id)+'/staging.json',{order:orderName(r),discard:r.revision},{signal});
  await store.remove(owner(site,id)+'/head.json');
  await withIdleInputs(store,scope,site,id,()=>collectFiles(store,scope,site,path,id));
  return {discarded:true};
 },{write:true,signal});
}
