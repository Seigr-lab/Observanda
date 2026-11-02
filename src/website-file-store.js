import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {Readable,PassThrough} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {withNativeDestination} from './native-destination.js';
import {writeSegmentedContent} from './segmented-file-write.js';
import {withStagingCapacity} from './staging-reservations.js';
import {readSegmentedRange,segmentedFileHeader} from './segmented-file-io.js';
import {unseal} from './encryption.js';
import {FileContent} from './file-content.js';
import {assertWorkspaceAvailable} from './workspace-lifecycle-admission.js';
import {AppError} from './errors.js';
import {assertPublicFiles} from './privacy.js';
import {websiteFileName,validateWebsiteHTML,validateWebsiteCSS} from './website-file-policy.js';
import {escapeWebsiteText,websiteDocumentTitle,websiteSourcePlacements,websiteMarkerShape,insertWebsiteSource,updateWebsiteSource} from './website-file-html.js';

const ROOT='.observanda/website-files',CONTROL_LIMIT=32*1024*1024,TEXT_LIMIT=16*1024*1024,active=new AsyncLocalStorage();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const recordIndex=(owner,record,target)=>ROOT+'/record-sources/'+hash(plain([owner,record,target]))+'.json';
const styleName=id=>'source-'+id+'.css';
const sourceURL=(page,name)=>path.posix.relative(path.posix.dirname(page),name);
const atPage=(html,page)=>page.includes('/')?html.replace(/(\b(?:src|href|poster)\s*=\s*["'])(assets\/[a-f0-9]{64}\.[a-z0-9]+)/gi,(_,prefix,name)=>prefix+sourceURL(page,name)):html;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const siteName=id=>{if(id===null)return 'default';if(!uuid(id))throw new AppError('INVALID');return id;};
const contentType=name=>name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')?'application/javascript; charset=utf-8':({'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp','gif':'image/gif','svg':'image/svg+xml','mp4':'video/mp4','mp3':'audio/mpeg','woff2':'font/woff2','pdf':'application/pdf'})[name.split('.').at(-1)]??'application/octet-stream';
const plain=value=>JSON.stringify(value);
const title=value=>{if(typeof value!=='string'||!value.trim()||value.length>200)throw new AppError('INVALID');return value.trim();};
export function websiteSourceId({workspaceId,projectId=null,notebookId,recordId,target='website'}){
 if(!uuid(workspaceId)||projectId!==null&&!uuid(projectId)||!uuid(notebookId)||!uuid(recordId)||!['website','pdf'].includes(target))throw new AppError('INVALID');
 return hash(plain([workspaceId,projectId,notebookId,recordId,target]));
}

// The subclass owns literal file bytes, not a research projection. Each stream
// rechecks current publication permission and pins the actual file descriptor.
export class WebsiteFileContent extends FileContent{
 constructor(store,siteId,revision,descriptor){super(store.workspace,store.absolute(descriptor.blob),descriptor.size,descriptor.sha256);this.store=store;this.siteId=siteId;this.revision=revision;this.descriptor=descriptor;}
 async *read(start=0,end=this.size-1,{signal}={}){
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start&&this.size!==0||end>=this.size)throw new AppError('INVALID');
  const output=new PassThrough({objectMode:true,highWaterMark:1});output.on('error',()=>{});let failure;
  const pending=this.store.scope(async scope=>{
   if(this.siteId!==undefined)await this.store.current(this.siteId,this.revision);
   await scope.member(this.file,async(directory,name)=>{
    const handle=await directory.file(name),vault=this.workspace.vault,key=vault.key,keyCopy=Buffer.from(key),owner=this;
    const check=async()=>{signal?.throwIfAborted();if(owner.workspace.vault!==vault||vault.key!==key||!keyCopy.equals(key))throw new AppError('ACCESS_LOCKED');};
    try{
     const options={size:this.size,sha256:this.sha256,signal,check};
     if(!this.size){await segmentedFileHeader(handle,key,this.workspace.fileAAD(this.file),options);output.end();}
     else await pipeline(Readable.from(readSegmentedRange(handle,key,this.workspace.fileAAD(this.file),start,end,options)),output,...(signal?[{signal}]:[]));
    }finally{keyCopy.fill(0);await handle.close();}
   });
  },{signal}).catch(error=>{failure=error;output.destroy(error);});
  try{yield* output;await pending;if(failure)throw failure;}finally{output.destroy();await pending;}
 }
 readChunks(start,end,options){return this.read(start,end,options);}
 readStaged(options){return this.read(0,this.size-1,options);}
 async verify(options){const digest=createHash('sha256');let size=0;for await(const bytes of this.read(0,this.size-1,options)){digest.update(bytes);size+=bytes.length;}if(size!==this.size||digest.digest('hex')!==this.sha256)throw new AppError('MEDIA_INVALID');return this;}
 verifyMetadata(options){return this.verify(options);}
}

export class WebsiteFileStore{
 constructor(workspace){this.workspace=workspace;}
 absolute(relative){return path.join(this.workspace.root,...relative.split('/'));}
 async scope(operation,{write=false,signal}={}){
  const prior=active.getStore();if(prior?.root===this.workspace.root){if(write&&!prior.write)throw new AppError('LOCKED');return operation(prior.scope);}
  signal?.throwIfAborted();await this.workspace.requireStorageKey();if(!this.workspace.vault?.id||!Buffer.isBuffer(this.workspace.vault.key))throw new AppError('ACCESS_LOCKED');await assertWorkspaceAvailable(this.workspace.root);
  return withNativeDestination(this.workspace.root,async scope=>{
   await scope.admit();let lease;
   if(write){await scope.ensure(ROOT);const deadline=Date.now()+30000;for(;;){try{lease=await scope.member(this.absolute(ROOT+'/writer'),(directory,name)=>directory.lease(name));break;}catch(error){if(error.code!=='EBUSY'||Date.now()>=deadline)throw error;await delay(25,undefined,{signal});}}}
   try{await assertWorkspaceAvailable(this.workspace.root);const run=admission=>active.run({root:this.workspace.root,scope,write,admission},()=>operation(scope));return await (write?withStagingCapacity(this.workspace,run,{signal}):run());}
   finally{await lease?.close();}
  });
 }
 async bytes(relative,{limit=CONTROL_LIMIT,missing=false}={}){
  const scope=active.getStore()?.scope;if(!scope)throw new AppError('LOCKED');const file=this.absolute(relative);
  if(!await scope.stat(file,{missing:true}))return missing?null:Promise.reject(new AppError('NOT_FOUND'));
  const result=unseal(await scope.read(file,{limit:limit+1024*1024}),this.workspace.vault.key,this.workspace.fileAAD(file));if(result.length>limit)throw new AppError('LIMIT');return result;
 }
 async control(relative,{missing=false}={}){const bytes=await this.bytes(relative,{missing});if(bytes===null)return null;try{return JSON.parse(bytes.toString('utf8'));}catch{throw new AppError('FORMAT');}}
 async writeBytes(relative,bytes,{signal}={}){
  const scope=active.getStore()?.scope;if(!active.getStore()?.write)throw new AppError('LOCKED');const file=this.absolute(relative);await scope.ensure(relative.slice(0,relative.lastIndexOf('/')));
  return writeSegmentedContent(this.workspace,file,[bytes],{expected:{size:bytes.length,sha256:hash(bytes)},signal,admission:active.getStore()?.admission,reserveBytes:64*1024*1024});
 }
 writeControl(relative,value,options){return this.writeBytes(relative,Buffer.from(plain(value)),options);}
 async remove(relative){return active.getStore().scope.remove(this.absolute(relative),{missing:true});}
 async names(relative,{after=null,limit=25,directories=true}={}){
  if(after!==null&&typeof after!=='string'||!Number.isInteger(limit)||limit<1||limit>100)throw new AppError('INVALID');
  const items=[];let hasMore=false;
  await active.getStore().scope.member(this.absolute(relative+'/sentinel'),async directory=>{
   if(!directory)return;for await(const entry of directory.entries()){
    if(entry.directory!==directories||after!==null&&entry.name<=after)continue;
    items.push(entry.name);items.sort();if(items.length>limit){items.pop();hasMore=true;}
   }
  },{missing:true});return {items,next:hasMore?items.at(-1):null};
 }
 async descriptor(name,value,{signal,owner}={}){
  websiteFileName(name);let bytes,source,expected;
  if(typeof value==='string'||Buffer.isBuffer(value)||value instanceof Uint8Array)bytes=Buffer.from(value);
  else if(value?.bytes instanceof FileContent){source=value.bytes.readStaged({signal});expected={size:value.bytes.size,sha256:value.bytes.sha256};}
  else if(value?.bytes!==undefined)bytes=Buffer.from(value.bytes);
  else if(value instanceof FileContent){source=value.readStaged({signal});expected={size:value.size,sha256:value.sha256};}
  else if(value?.content instanceof FileContent){source=value.content.readStaged({signal});expected={size:value.content.size,sha256:value.content.sha256};}
  else throw new AppError('INVALID');
  if(!owner||!owner.startsWith(ROOT+'/sites/')&&!owner.startsWith(ROOT+'/sources/'))throw new AppError('INVALID');
  if(bytes){source=[bytes];expected={size:bytes.length,sha256:hash(bytes)};}
  const suffix=path.posix.extname(name).toLowerCase(),blob=owner+'/files/'+expected.sha256+(/^[.][a-z0-9]{1,12}$/.test(suffix)?suffix:'.file'),scope=active.getStore().scope,file=this.absolute(blob);await scope.ensure(owner+'/files');
  // Repeated saves of unchanged pages and assets share the exact same encrypted
  // file in this owner. Authenticate an existing descriptor before using it.
  const exists=await scope.stat(file,{missing:true});let saved=expected;
  if(exists)await scope.member(file,async(directory,member)=>{const handle=await directory.file(member);try{await segmentedFileHeader(handle,this.workspace.vault.key,this.workspace.fileAAD(file),expected);}finally{await handle.close();}});
  else saved=await writeSegmentedContent(this.workspace,file,source,{expected,signal,admission:active.getStore()?.admission,reserveBytes:64*1024*1024,exclusive:true});
  return {name,blob,...saved,contentType:value?.contentType??contentType(name)};
 }
 validBlob(file,id,sources){
  const own=ROOT+'/sites/'+siteName(id)+'/files/',source=typeof file.sourceId==='string'&&sources.some(item=>item.id===file.sourceId)?ROOT+'/sources/'+file.sourceId+'/files/':null;
  const base=file.blob?.startsWith(own)?own:source&&file.blob?.startsWith(source)?source:null;
  return base!==null&&file.blob.slice(base.length).startsWith(file.sha256+'.')&&/^[a-f0-9]{64}\.[a-z0-9]{1,12}$/.test(file.blob.slice(base.length));
 }
 validateManifest(value,id){
  if(value?.version!==1||value.id!==id||!hex(value.revision)||!Array.isArray(value.files)||!Array.isArray(value.pages)||!Array.isArray(value.sources))throw new AppError('FORMAT');
  const names=new Set();for(const file of value.files){websiteFileName(file.name);if(names.has(file.name)||!this.validBlob(file,id,value.sources)||!Number.isSafeInteger(file.size)||file.size<0||!hex(file.sha256)||typeof file.contentType!=='string')throw new AppError('FORMAT');names.add(file.name);}
  for(const source of value.sources)if(!hex(source.id)||!hex(source.revision))throw new AppError('FORMAT');return value;
 }
 async raw(id,{missing=false}={}){
  const site=siteName(id),head=await this.control(ROOT+'/sites/'+site+'/head.json',{missing});if(!head)return null;if(!hex(head.revision))throw new AppError('FORMAT');
  return this.validateManifest(await this.control(ROOT+'/sites/'+site+'/revisions/'+head.revision+'.json'),id);
 }
 async siteAssets(local,placements){
  const files=new Map(local.filter(file=>!file.sourceId).map(file=>[file.name,file]));
  for(const placement of placements){
   const source=await this.source(placement.id,{pending:true});
   if(!source||source.revision!==placement.revision||source.target!=='website')throw new AppError('CONFLICT');
   for(const asset of [...source.assets,{...source.css,name:styleName(source.id)}]){
    const other=files.get(asset.name);if(other&&other.sha256!==asset.sha256)throw new AppError('CONFLICT');
    // A copied asset is owned by at least one currently permitted source.
    // If another source still permits the same bytes, use its own descriptor.
    files.set(asset.name,{...asset,sourceId:source.id});
   }
  }
  return [...files.values()];
 }
 async assertSources(manifest){
  for(const source of manifest.sources){
   if(await this.control(ROOT+'/sources/'+source.id+'/pending.json',{missing:true}))throw new AppError('CONFLICT');
   const current=await this.control(ROOT+'/sources/'+source.id+'/head.json');if(current.target!=='website'||current.revision!==source.revision)throw new AppError('CONFLICT');
  }
 }
 async pendingSources(){
  const value=await this.control(ROOT+'/pending.json',{missing:true});if(value!==null&&(!Array.isArray(value)||value.some(id=>!hex(id))))throw new AppError('FORMAT');return new Set(value??[]);
 }
 async fence(sourceId,set,signal){
  const entries=await this.pendingSources();if(set)entries.add(sourceId);else entries.delete(sourceId);
  if(entries.size)await this.writeControl(ROOT+'/pending.json',[...entries],{signal});else await this.remove(ROOT+'/pending.json');
 }
 async current(id,revision){
  const manifest=await this.raw(id);if(revision!==undefined&&revision!==manifest.revision)throw new AppError('CONFLICT');
  // A permission writer publishes this fence *before* changing research and
  // clears it only after every affected HTML/page manifest is committed. An
  // ordinary read checks one tiny file regardless of the number of sources.
  if(manifest.sources.length){const pending=await this.pendingSources();if(manifest.sources.some(item=>pending.has(item.id)))throw new AppError('CONFLICT');}
  return manifest;
 }
 site(manifest){return {id:manifest.id,name:manifest.name,revision:manifest.revision,pages:manifest.pages.map(({path,title})=>({path,title})),cssPath:manifest.cssPath};}
 async commit(manifest,{signal}={}){
  const previous=await this.raw(manifest.id,{missing:true}),value={...manifest,version:1,updatedAt:new Date().toISOString()};delete value.revision;value.revision=hash(plain(value));const directory=ROOT+'/sites/'+siteName(value.id);
  // Register placement before publishing the new site head. A crash may
  // leave an unused index row, but can never create an unindexed live copy.
  const previousSources=new Set(previous?.sources.map(source=>source.id));for(const source of value.sources)if(!previousSources.has(source.id)){
   await this.writeControl(ROOT+'/sources/'+source.id+'/placements/'+siteName(value.id)+'.json',{siteId:value.id,sourceId:source.id},{signal});
  }
  await this.writeControl(directory+'/revisions/'+value.revision+'.json',value,{signal});await this.writeControl(directory+'/head.json',{revision:value.revision},{signal});
  if(previous&&previous.revision!==value.revision){
   const currentSources=new Set(value.sources.map(source=>source.id));for(const source of previous.sources)if(!currentSources.has(source.id))await this.remove(ROOT+'/sources/'+source.id+'/placements/'+siteName(value.id)+'.json');
   const retained=new Set(value.files.map(file=>file.blob));
   for(const blob of new Set(previous.files.map(file=>file.blob)))if(!retained.has(blob)&&blob.startsWith(directory+'/files/'))await this.remove(blob);
   await this.remove(directory+'/revisions/'+previous.revision+'.json');
  }return value;
 }
 async readText(descriptor,{signal}={}){if(descriptor.size>TEXT_LIMIT)throw new AppError('LIMIT');const parts=[];for await(const bytes of new WebsiteFileContent(this,undefined,null,descriptor).read(0,descriptor.size-1,{signal}))parts.push(bytes);return Buffer.concat(parts).toString('utf8');}
 async scripts(files){const allowed=new Set();for(const descriptor of files)if(descriptor.name.endsWith('.js')){assertPublicFiles(new Map([[descriptor.name,await this.readText(descriptor)]]));allowed.add(descriptor.name);}return allowed;}
 async present(manifest,page='index.html',{signal}={}){
  websiteFileName(page);const selected=manifest.files.find(file=>file.name===page),css=manifest.files.find(file=>file.name===manifest.cssPath);if(!selected||!page.endsWith('.html'))throw new AppError('NOT_FOUND');
  return {site:this.site(manifest),path:page,html:await this.readText(selected,{signal}),css:css?await this.readText(css,{signal}):''};
 }
 list(options={}){return this.scope(async()=>{const page=await this.names(ROOT+'/sites',options),items=[],pending=await this.pendingSources();for(const name of page.items){const manifest=await this.raw(name==='default'?null:name);const item=this.site(manifest);if(manifest.sources.some(source=>pending.has(source.id))){item.pages=[];item.pending=true;}items.push(item);}return {items,next:page.next};},options);}
 create({id=randomUUID(),name,html,css='',signal}={}){
  name=title(name);html??='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeWebsiteText(name)+'</title><link rel="stylesheet" href="style.css"></head><body><main><h1>'+escapeWebsiteText(name)+'</h1></main></body></html>';
  return this.importFiles(id,{name,files:new Map([['index.html',html],['style.css',css]]),signal});
 }
 importFiles(id,{name,files,expectedRevision,signal}={}){return this.scope(async()=>{
  siteName(id);name=title(name);if(!(files instanceof Map)||!files.has('index.html'))throw new AppError('INVALID');const previous=await this.raw(id,{missing:true});
  if(previous?expectedRevision!==previous.revision:expectedRevision!==undefined)throw new AppError(previous?'CONFLICT':'NOT_FOUND');
  const descriptors=[];for(const [name,value] of files){signal?.throwIfAborted();descriptors.push(await this.descriptor(name,value,{signal,owner:ROOT+'/sites/'+siteName(id)}));}
  const scripts=await this.scripts(descriptors),pages=[],sources=new Map();
  for(const descriptor of descriptors){if(descriptor.name.endsWith('.html')){const html=await this.readText(descriptor,{signal});validateWebsiteHTML(html,{scripts,file:descriptor.name});const placements=websiteSourcePlacements(html);pages.push({path:descriptor.name,title:websiteDocumentTitle(html),placements});for(const source of placements)sources.set(source.id,source);}else if(descriptor.name.endsWith('.css'))validateWebsiteCSS(await this.readText(descriptor,{signal}),{file:descriptor.name});}
  const placements=[...sources.values()],candidate={id,name,pages,cssPath:descriptors.some(file=>file.name==='style.css')?'style.css':descriptors.some(file=>file.name==='styles.css')?'styles.css':'style.css',files:await this.siteAssets(descriptors,placements),sources:placements};await this.assertSources(candidate);
  return this.present(await this.commit(candidate,{signal}),'index.html',{signal});
 },{write:true,signal});}
 open(id,{path:page='index.html',signal}={}){return this.scope(async()=>this.present(await this.current(id),page,{signal}),{signal});}
 save(id,{expectedRevision,path:page='index.html',html,css,title:pageTitle,signal}={}){return this.scope(async()=>{
  const manifest=await this.current(id,expectedRevision);if(!hex(expectedRevision))throw new AppError('INVALID');websiteFileName(page);if(!page.endsWith('.html'))throw new AppError('INVALID');
  validateWebsiteHTML(html,{scripts:await this.scripts(manifest.files),file:page});validateWebsiteCSS(css,{file:manifest.cssPath});const sources=new Map(),owner=ROOT+'/sites/'+siteName(id);
  const former=manifest.pages.find(item=>item.path===page),placements=websiteSourcePlacements(html);
  if(former?.placements.length||placements.length){
   const old=manifest.files.find(file=>file.name===page);const previous=old?await this.readText(old,{signal}):'';
   if(plain(websiteMarkerShape(previous))!==plain(websiteMarkerShape(html)))throw new AppError('CONFLICT');
  }
  const files=manifest.files.filter(file=>file.name!==page&&file.name!==manifest.cssPath);files.push(await this.descriptor(page,html,{signal,owner}),await this.descriptor(manifest.cssPath,css,{signal,owner}));
  const pages=manifest.pages.filter(value=>value.path!==page);pages.push({path:page,title:pageTitle?title(pageTitle):websiteDocumentTitle(html),placements});
  for(const value of pages)for(const source of value.placements)sources.set(source.id,source);
  const candidate={...manifest,files,pages,sources:[...sources.values()]};await this.assertSources(candidate);return this.present(await this.commit(candidate,{signal}),page,{signal});
 },{write:true,signal});}
 checkRevision(id,revision){return this.scope(async()=>this.site(await this.current(id,revision)));}
 withSite(id,revision,operation){return this.scope(async()=>{const manifest=await this.current(id,revision);return operation(this.site(manifest));},{write:true});}
 file(id,name,{revision,signal}={}){return this.scope(async()=>{
  websiteFileName(name);const manifest=await this.current(id,revision),descriptor=manifest.files.find(file=>file.name===name);if(!descriptor)throw new AppError('NOT_FOUND');const content=new WebsiteFileContent(this,id,manifest.revision,descriptor);
  return {content,contentType:descriptor.contentType,revision:manifest.revision,size:descriptor.size,sha256:descriptor.sha256,};
 },{signal});}
 export(id,{expectedRevision,signal}={}){return this.scope(async()=>{const manifest=await this.current(id,expectedRevision),files=new Map();for(const descriptor of manifest.files)files.set(descriptor.name,new WebsiteFileContent(this,id,manifest.revision,descriptor));return {revision:manifest.revision,site:this.site(manifest),files};},{signal});}
 async source(id,{pending=false}={}){
  if(!hex(id))throw new AppError('INVALID');const directory=ROOT+'/sources/'+id;
  if(!pending&&(await this.pendingSources()).has(id))throw new AppError('CONFLICT');
  const result=await this.control(directory+'/head.json',{missing:true});if(result&&(result.id!==id||!hex(result.revision)))throw new AppError('FORMAT');return result;
 }
 library(options={}){return this.scope(async()=>{const page=await this.names(ROOT+'/sources',options),items=[],pending=await this.pendingSources();for(const id of page.items){if(pending.has(id))continue;const source=await this.source(id,{pending:true});if(source?.visible&&source.target===(options.target??'website'))items.push({id,title:source.title,revision:source.revision,target:source.target??'website',...(source.provenance?{workspaceId:source.provenance.workspaceId,recordId:source.provenance.recordId,notebookId:source.provenance.notebookId}:{})});}return {items,next:page.next};},options);}
 sourceForRecord({workspaceId,recordId,target='website'}={}){
  if(!uuid(workspaceId)||!uuid(recordId)||!['website','pdf'].includes(target))throw new AppError('INVALID');
  return this.scope(async()=>{const index=await this.control(recordIndex(workspaceId,recordId,target),{missing:true});if(!index)return null;
   const source=await this.source(index.sourceId);if(!source||source.target!==target||source.provenance?.workspaceId!==workspaceId||source.provenance?.recordId!==recordId)throw new AppError('FORMAT');
   return {id:source.id,visible:source.visible,revision:source.revision,title:source.title,target,provenance:source.provenance};
  });
 }
 getSource(sourceId,{signal,target='website'}={}){return this.scope(async()=>{const source=await this.source(sourceId);if(!source?.visible||source.target!==target)throw new AppError('NOT_FOUND');
  return {id:sourceId,revision:source.revision,provenance:source.provenance,title:source.title,target,html:await this.readText(source.html,{signal}),css:await this.readText(source.css,{signal}),assets:source.assets.map(file=>({path:file.name,size:file.size,sha256:file.sha256,contentType:file.contentType}))};
 },{signal});}
 pdfSource(sourceId,{revision,signal}={}){
  return this.scope(async()=>{const source=await this.source(sourceId);if(!source?.visible||source.target!=='pdf'||!source.pdfParts)throw new AppError('NOT_FOUND');if(revision!==undefined&&revision!==source.revision)throw new AppError('CONFLICT');
   const parts=JSON.parse(await this.readText(source.pdfParts,{signal}));if((await this.source(sourceId))?.revision!==source.revision)throw new AppError('PDF_SOURCE_CONTENT');return {id:sourceId,revision:source.revision,title:source.title,provenance:source.provenance,parts,assets:source.assets.map(file=>({path:file.name,size:file.size,sha256:file.sha256,contentType:file.contentType}))};
  },{signal});
 }
 pdfAsset(sourceId,name,{revision,signal,limit}={}){
  return this.scope(async()=>{const source=await this.source(sourceId);if(!source?.visible||source.target!=='pdf'||source.revision!==revision)throw new AppError('PDF_SOURCE_CONTENT');const descriptor=source.assets.find(asset=>asset.name===name);
   if(!descriptor||!Number.isSafeInteger(limit)||limit<0||descriptor.size>limit)throw new AppError('PDF_CAPACITY');const value=Buffer.allocUnsafe(descriptor.size);let offset=0;
   for await(const chunk of new WebsiteFileContent(this,undefined,null,descriptor).read(0,descriptor.size-1,{signal})){value.set(chunk,offset);offset+=chunk.length;}
   if((await this.source(sourceId))?.revision!==revision)throw new AppError('PDF_SOURCE_CONTENT');return value;
  },{signal});
 }
 sourceStatus(sourceId){return this.scope(async()=>({source:await this.source(sourceId,{pending:true}),pending:await this.control(ROOT+'/sources/'+sourceId+'/pending.json',{missing:true})}));}
 beginSourceUpdate({sourceId,signal,ifAbsent=false}={}){return this.scope(async()=>{if(!hex(sourceId))throw new AppError('INVALID');const token=randomUUID(),saved=await this.control(ROOT+'/sources/'+sourceId+'/pending.json',{missing:true}),previous=saved?saved.previous:await this.source(sourceId,{pending:true});if(ifAbsent&&(saved||previous||(await this.pendingSources()).has(sourceId)))throw new AppError('EXISTS');await this.fence(sourceId,true,signal);await this.writeControl(ROOT+'/sources/'+sourceId+'/pending.json',{token,previous,startedAt:saved?.startedAt??new Date().toISOString(),recovered:Boolean(saved)},{signal});return token;},{write:true,signal});}
 cancelSourceUpdate({sourceId,token,signal}={}){return this.scope(async()=>{if(!hex(sourceId)||!uuid(token))throw new AppError('INVALID');const pending=await this.control(ROOT+'/sources/'+sourceId+'/pending.json');const current=await this.source(sourceId,{pending:true});if(pending.recovered||pending.token!==token||(current?.revision??null)!==(pending.previous?.revision??null))throw new AppError('CONFLICT');await this.remove(ROOT+'/sources/'+sourceId+'/pending.json');await this.fence(sourceId,false,signal);},{write:true,signal});}
 putSource({sourceId,title:sourceTitle,html='',css='',assets=[],provenance,pdfParts=null,visible=true,target='website',signal}={}, {token}={}){return this.scope(async()=>{
  if(!hex(sourceId)||!uuid(token)||typeof visible!=='boolean'||!['website','pdf'].includes(target))throw new AppError('INVALID');const directory=ROOT+'/sources/'+sourceId,pending=await this.control(directory+'/pending.json');if(pending.token!==token)throw new AppError('CONFLICT');
  sourceTitle=title(sourceTitle);validateWebsiteHTML('<!doctype html><html><head><title>Content</title></head><body>'+html+'</body></html>');validateWebsiteCSS(css);
  if(provenance&&websiteSourceId({...provenance,target})!==sourceId)throw new AppError('INVALID');
  const prior=pending.previous,previousHtml=prior?await this.readText(prior.html,{signal}):'',files=[];
  if(visible)for(const asset of assets){if(!/^assets\/[a-f0-9]{64}\.[a-z0-9]{1,12}$/.test(asset.path??''))throw new AppError('INVALID');const descriptor=await this.descriptor(asset.path,asset,{signal,owner:directory});if(asset.path.slice(7,71)!==descriptor.sha256)throw new AppError('MEDIA_INVALID');files.push(descriptor);}
  const source={id:sourceId,title:sourceTitle,target,visible,provenance,html:await this.descriptor('fragment.html',visible?html:'',{signal,owner:directory}),css:await this.descriptor('source.css',visible?css:'',{signal,owner:directory}),assets:files};if(visible&&target==='pdf'){if(!pdfParts||pdfParts.version!==1)throw new AppError('PDF_SOURCE_CONTENT');source.pdfParts=await this.descriptor('composition.json',plain(pdfParts),{signal,owner:directory});}source.revision=hash(plain(source));
  await this.writeControl(directory+'/head.json',source,{signal});if(provenance)await this.writeControl(recordIndex(provenance.workspaceId,provenance.recordId,target),{sourceId},{signal});
  let after=null;do{const sites=await this.names(directory+'/placements',{after,limit:25,directories:false});for(const member of sites.items){
   signal?.throwIfAborted();const row=await this.control(directory+'/placements/'+member);if(row.sourceId!==sourceId||siteName(row.siteId)+'.json'!==member)throw new AppError('FORMAT');
   const id=row.siteId,manifest=await this.raw(id,{missing:true});if(!manifest?.sources.some(value=>value.id===sourceId))continue;
   const affected=new Set(manifest.pages.filter(page=>page.placements.some(value=>value.id===sourceId)).map(page=>page.path)),titles=new Map();
   const nextFiles=[];for(const descriptor of manifest.files){
    if(affected.has(descriptor.name)){const original=await this.readText(descriptor,{signal}),updated=updateWebsiteSource(original,{id:sourceId,revision:source.revision,previousHtml:atPage(previousHtml,descriptor.name),html:atPage(html,descriptor.name),visible});if(updated!==original)titles.set(descriptor.name,websiteDocumentTitle(updated));nextFiles.push(updated===original?descriptor:await this.descriptor(descriptor.name,updated,{signal,owner:ROOT+'/sites/'+siteName(id)}));}
    else if(descriptor.sourceId!==sourceId)nextFiles.push(descriptor);
   }
   const sources=manifest.sources.map(value=>value.id===sourceId?{id:sourceId,revision:source.revision}:value);
   await this.commit({...manifest,pages:manifest.pages.map(page=>({...page,title:titles.get(page.path)??page.title,placements:page.placements.map(item=>item.id===sourceId?{id:sourceId,revision:source.revision}:item)})),files:await this.siteAssets(nextFiles,sources),sources},{signal});
  }after=sites.next;}while(after!==null);
  if(prior){const retained=new Set([source.html,source.css,...source.assets,...(source.pdfParts?[source.pdfParts]:[])].map(file=>file.blob));for(const file of [prior.html,prior.css,...prior.assets,...(prior.pdfParts?[prior.pdfParts]:[])])if(!retained.has(file.blob))await this.remove(file.blob);}
  await this.remove(directory+'/pending.json');await this.fence(sourceId,false,signal);return {id:sourceId,title:sourceTitle,revision:source.revision,visible,target};
 },{write:true,signal});}
 insertSource(id,{expectedRevision,path:page='index.html',sourceId,signal}={}){return this.scope(async()=>{
  if(!hex(expectedRevision))throw new AppError('INVALID');const manifest=await this.current(id,expectedRevision),source=await this.source(sourceId);if(!source?.visible||source.target==='pdf')throw new AppError('NOT_FOUND');
  const opened=await this.present(manifest,page,{signal}),fragment=await this.readText(source.html,{signal});let html=insertWebsiteSource(opened.html,{id:sourceId,revision:source.revision,html:atPage(fragment,page)});
  const cssPath=sourceURL(page,styleName(sourceId));if(!html.includes('href="'+cssPath+'"'))html=html.replace(/<\/head\s*>/i,'<link rel="stylesheet" href="'+cssPath+'"></head>');
  const local=manifest.files.filter(file=>!file.sourceId&&file.name!==page);local.push(await this.descriptor(page,html,{signal,owner:ROOT+'/sites/'+siteName(id)}));
  const sources=manifest.sources.filter(value=>value.id!==sourceId);sources.push({id:sourceId,revision:source.revision});const files=await this.siteAssets(local,sources);
  return this.present(await this.commit({...manifest,files,sources,pages:manifest.pages.map(value=>value.path===page?{...value,placements:websiteSourcePlacements(html)}:value)},{signal}),page,{signal});
 },{write:true,signal});}
 publicationWorkspace(id){
  siteName(id);const store=this,base=this.workspace,prefix=ROOT+'/sites/'+siteName(id)+'/publication';
  const relative=name=>{if(typeof name!=='string'||!name.startsWith('.observanda/'))throw new AppError('UNSAFE');websiteFileName(name.slice(12));return prefix+'/'+name.slice(12);};
  return {root:base.root,vault:base.vault,websiteId:id,websiteContext:true,baseWorkspace:base,
   withLock:operation=>store.scope(()=>operation(),{write:true}),
   readMetadata:(name,limit=CONTROL_LIMIT)=>store.scope(async()=>{const bytes=await store.bytes(relative(name),{missing:true,limit});return bytes?.toString('utf8')??null;}),
   writeMetadata:(name,text)=>store.scope(()=>store.writeBytes(relative(name),Buffer.from(text)),{write:true}),
   removeMetadata:name=>store.scope(()=>store.remove(relative(name)),{write:true}),
   metadataPath:name=>store.absolute(relative(name)),
   requireStorageKey:()=>base.requireStorageKey(),fileAAD:file=>base.fileAAD(file),
   async *metadataNames(name){let after=null;do{const page=await store.scope(()=>store.names(relative(name),{after,directories:false,limit:100}));yield* page.items;after=page.next;}while(after!==null);},
   async listMetadata(name){const result=[];for await(const value of this.metadataNames(name))result.push(value);return result;}
  };
 }
}
