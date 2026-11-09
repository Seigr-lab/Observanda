import path from 'node:path';
import {starterPage,starterStyles} from './web/website-file-starter.js';
import {readFile} from 'node:fs/promises';
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
import {recoveryAssets} from './website-recovery.js';
import {assertPublicFiles} from './privacy.js';
import {replaceSourceTags} from './website-source-tags.js';
import {PUBLIC_GALLERY_SCRIPT} from './publication-gallery.js';
import {publicPictureNames,saveWebsitePictures} from './website-picture-files.js';
import {websiteFileName,validateWebsiteHTML,validateWebsiteCSS} from './website-file-policy.js';
import {readSiteMenu,saveSiteMenu,inheritSiteMenu} from './website-menu-storage.js';
import {escapeWebsiteText,websiteDocumentTitle,websiteSourcePlacements,websiteMarkerShape,insertWebsiteSources,updateWebsiteSource} from './website-file-html.js';
import {assertPageDestination,websitePageIdentity} from './website-page-paths.js';
import {indexWebsiteSource,searchWebsiteLibrary,previewWebsiteSource} from './website-file-library.js';
import {checkComponentManifest,checkSavedComponents,retainComponentAssets} from './website-component-storage.js';
import {publicRecordingNames,saveWebsiteRecordings} from './website-recordings.js';
import {editHistory,editHistoryStamp,retainEditHistory,validateEditHistory} from './website-edit-history.js';
import {sourceGalleryItems,refreshSourceGalleries} from './website-source-gallery-items.js';
import {entryDisplayChoices,sourceFragmentAtPage as atPage} from './website-entry-display.js';
import {entryCSS,entryStyleHash,entryStyleName,styledPageHTML,usesEntryStyle,syncEntryStyles} from './website-entry-styles.js';
import {fileHasEditorMenu} from './website-menu-styles.js';
import {clearFeedSubscription,reflowFeedShell,refreshFeedSubscriptions,retainWebsiteFeedAssets,validateFeedFiles,websiteFeedPages,writeFeedSubscription} from './website-dynamic-feeds.js';
import {releasePreviousFeedSource,synchronizeFeedSource} from './website-feed-source.js';
import {syncFeedShells} from './website-feed-shell.js';
import {pendingScopeFile,siteHasPendingSources,sourceFenceScope} from './website-feed-fence.js';
import {prepareFeedUsage,finishFeedUsage} from './website-feed-usage-index.js';
import {syncSavedAppearance,validateSavedAppearance} from './website-saved-appearance.js';
import {validatePageDesigns} from './website-page-designs.js';
import {addPageStyle,newPageStylesheet,pageStylesheet,sharedDraftStyle,validatePageStyles} from './website-page-style.js';
import {preparePublicPageFiles,privateWebsiteNames,publicText,websiteFileReferences} from './website-page-dependencies.js';
import {syncWebsiteThemes,validateWebsiteThemes} from './website-scoped-themes.js';
import {syncStyleResources,validateStyleResources} from './website-style-resources.js';
import {beginVersionWrite,prepareVersionRetention} from './website-version-retention.js';

const ROOT='.observanda/website-files',CONTROL_LIMIT=32*1024*1024,TEXT_LIMIT=16*1024*1024,active=new AsyncLocalStorage();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const recordIndex=(owner,record,target)=>ROOT+'/record-sources/'+hash(plain([owner,record,target]))+'.json';
const styleName=id=>'source-'+id+'.css';
const sourceFiles=source=>[...source.assets,{...source.css,name:styleName(source.id)}];
function includeAsset(files,source,asset,draft){
 const other=files.get(asset.name);if(other&&other.sha256!==asset.sha256)throw new AppError('CONFLICT');
 if(!other||other.draft||!draft)files.set(asset.name,{...asset,sourceId:source.id,...(draft?{draft:true}:{})});
}
const siteOwner=(id,draft)=>ROOT+'/sites/'+siteName(id)+(draft?'/drafts':'');
function assetSources(pages){
 const uses=new Map();
 for(const page of pages)for(const row of page.placements){
  if(row.link)continue;
  if(!uses.has(row.id))uses.set(row.id,{all:false,names:new Set()});
  const use=uses.get(row.id);
  if(row.gallery)use.names.add(row.asset);
  else if(row.display)for(const asset of row.assets)use.names.add(asset);
  else use.all=true;
 }
 return uses;
}
const sourceURL=(page,name)=>path.posix.relative(path.posix.dirname(page),name);
const fileIdentity=file=>[file.name,file.blob,file.sha256,file.size,file.contentType,!!file.draft,file.sourceId??null];
function canvasAssetStamp(manifest,owned=new Set()){
 const ordered=manifest.files.filter(file=>!file.name.endsWith('.html')&&!owned.has(file.name)).map(fileIdentity).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
 return hash(plain(['canvas-assets',manifest.id,ordered]));
}
function canvasStyles(manifest){
 const files=new Map(manifest.files.map(file=>[file.name,file]));
 const owned=new Set(manifest.pages.flatMap(p=>p.stylePath?[p.stylePath]:[]));
 for(const file of manifest.files)if(file.tokenSheet||file.tokenFont)owned.add(file.name);
 const canvasAssets=canvasAssetStamp(manifest,owned);
 const styleMembers=new Map();
 function dependencies(sheet){
  if(!styleMembers.has(sheet)){
   const file=files.get(sheet),resources=file?.references?.filter(r=>owned.has(r.name)).map(r=>r.name);
   styleMembers.set(sheet,file&&!resources?null:resources??[]);
  }
  return styleMembers.get(sheet);
 }
 let allStamp;
 const pages=manifest.pages.map(page=>{
  const refs=files.get(page.path)?.references;
  // Authenticated older files without a dependency list conservatively depend
  // on every owned stylesheet until their next ordinary save.
  const next={...page};delete next.canvasStyles;
  if(!refs&&owned.size){next.canvasStyles={all:true,stamp:allStamp??=canvasAssetStamp(manifest)};return next;}
  const names=new Set((refs??[]).filter(r=>owned.has(r.name)).map(r=>r.name));
  if(page.stylePath)names.add(page.stylePath);
  if(manifest.styleBook?.tokens.length){
   const styles=new Set([page.stylePath??manifest.cssPath,manifest.cssPath,...(refs??[]).map(r=>r.name).filter(name=>name.endsWith('.css'))]);
   for(const sheet of styles){
    const resources=dependencies(sheet);
    if(!resources){next.canvasStyles={all:true,stamp:allStamp??=canvasAssetStamp(manifest)};return next;}
    for(const name of resources)names.add(name);
   }
  }
  if(names.size){
   const members=[...names].sort();
   next.canvasStyles={members,stamp:hash(plain([canvasAssets,members.map(name=>fileIdentity(files.get(name)))]))};
  }
  return next;
 });
 return {pages,canvasAssets};
}
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
   // The descriptor was authenticated when the file was opened. Check the
   // compact head and pending permissions again for each stream or range.
   if(this.siteId!==undefined&&await this.store.siteVersion(this.siteId,{signal})!==this.revision)throw new AppError('CONFLICT');
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

// Old revisions without derived files get the same publication bytes in a
// read-only operation. Each stream still checks the current site revision.
class RenderedWebsiteFile extends WebsiteFileContent{
 static async open(store,site,descriptor,signal,blocked){
  const content=new RenderedWebsiteFile(store,site.id,site.revision,descriptor);
  content.blocked=blocked;
  const bytes=await content.render(signal);content.size=bytes.length;content.sha256=hash(bytes);return content;
 }
 async render(signal){
  return this.store.scope(async()=>{
   await this.store.current(this.siteId,this.revision);
   const raw=await this.store.readText(this.descriptor,{signal});
   const name=this.descriptor.name,value=this.blocked?publicText(raw,name,this.blocked):raw;
   const bytes=Buffer.from(name.endsWith('.html')?styledPageHTML(value,name).html:value);
   await this.store.current(this.siteId,this.revision);return bytes;
  },{signal});
 }
 async *read(start=0,end=this.size-1,{signal}={}){
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start&&!(this.size===0&&start===0&&end===-1)||end>=this.size)throw new AppError('INVALID');
  const bytes=await this.render(signal);if(bytes.length!==this.size||hash(bytes)!==this.sha256)throw new AppError('MEDIA_INVALID');
  if(this.size)yield bytes.subarray(start,end+1);
 }
}
export class WebsiteFileStore{
 constructor(workspace,{actor}={}){this.workspace=workspace;this.versionActor=actor??{kind:'workspace'};}
 absolute(relative){return path.join(this.workspace.root,...relative.split('/'));}
 writerToken(){const held=active.getStore();return held?.root===this.workspace.root?held.writerToken:null;}
 async scope(operation,{write=false,signal}={}){
  const prior=active.getStore();if(prior?.root===this.workspace.root){if(write&&!prior.write)throw new AppError('LOCKED');return operation(prior.scope);}
  signal?.throwIfAborted();await this.workspace.requireStorageKey();if(!this.workspace.vault?.id||!Buffer.isBuffer(this.workspace.vault.key))throw new AppError('ACCESS_LOCKED');await assertWorkspaceAvailable(this.workspace.root);
  return withNativeDestination(this.workspace.root,async scope=>{
   await scope.admit();let lease;
   if(write){await scope.ensure(ROOT);const deadline=Date.now()+30000;for(;;){try{lease=await scope.member(this.absolute(ROOT+'/writer'),(directory,name)=>directory.lease(name));break;}catch(error){if(error.code!=='EBUSY'||Date.now()>=deadline)throw error;await delay(25,undefined,{signal});}}}
   const held={root:this.workspace.root,scope,write,writerToken:write?Symbol():null};
   try{await assertWorkspaceAvailable(this.workspace.root);const run=admission=>{held.admission=admission;return active.run(held,()=>operation(scope));};return await (write?withStagingCapacity(this.workspace,run,{signal}):run());}
   finally{held.writerToken=null;await lease?.close();}
  });
 }
 async bytes(relative,{limit=CONTROL_LIMIT,missing=false}={}){
  const scope=active.getStore()?.scope;if(!scope)throw new AppError('LOCKED');const file=this.absolute(relative);
  const sealed=await scope.read(file,{limit:limit+1024*1024,missing:true});
  if(sealed===null){if(missing)return null;throw new AppError('NOT_FOUND');}
  const result=unseal(sealed,this.workspace.vault.key,this.workspace.fileAAD(file));if(result.length>limit)throw new AppError('LIMIT');return result;
 }
 async control(relative,{missing=false,limit}={}){const bytes=await this.bytes(relative,{missing,limit});if(bytes===null)return null;try{return JSON.parse(bytes.toString('utf8'));}catch{throw new AppError('FORMAT');}}
 async writeBytes(relative,bytes,{signal}={}){
  const scope=active.getStore()?.scope;if(!active.getStore()?.write)throw new AppError('LOCKED');const file=this.absolute(relative);await scope.ensure(relative.slice(0,relative.lastIndexOf('/')));
  return writeSegmentedContent(this.workspace,file,[bytes],{expected:{size:bytes.length,sha256:hash(bytes)},signal,admission:active.getStore()?.admission,reserveBytes:64*1024*1024});
 }
 writeControl(relative,value,options){return this.writeBytes(relative,Buffer.from(plain(value)),options);}
 async remove(relative){return active.getStore().scope.remove(this.absolute(relative),{missing:true});}
 async discardStaged(blob){
  // A retry can reuse an old encrypted blob that is still held by an earlier
  // version. Only files physically created by this writer are rollback work.
  if(active.getStore()?.created?.delete(blob))await this.remove(blob);
 }
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
  else{
   const writer=active.getStore();
   saved=await writeSegmentedContent(this.workspace,file,source,{expected,signal,admission:writer.admission,reserveBytes:64*1024*1024,exclusive:true});
   (writer.created??=new Set()).add(blob);
  }
  return {name,blob,...saved,contentType:value?.contentType??contentType(name)};
 }
 async siteFile(id,name,value,{draft,signal}={}){
  let used=false,editorMenu;
  if(name.endsWith('.html')&&typeof value==='string'){
   const page=styledPageHTML(value,name);value=page.html;used=page.used;editorMenu=page.menu;
   if(Buffer.byteLength(value)>TEXT_LIMIT)throw new AppError('LIMIT');
  }
  const file=await this.descriptor(name,value,{signal,owner:siteOwner(id,draft)});
  const references=typeof value==='string'&&/\.(?:html|css)$/.test(name)?websiteFileReferences(value,name):undefined;
  const markup=name.endsWith('.html')&&typeof value==='string';
  return {...file,...(references?{references}:{}),...(draft?{draft:true}:{}),...(used?{entryStyle:entryStyleHash}:{}),...(editorMenu===undefined?{}:{editorMenu}),...(markup&&value.includes('data-website-theme')?{hasWebsiteThemes:true}:{}),...(markup&&(value.includes('ow-token-')||value.includes('data-website-token-sheet'))?{hasStyles:true}:{})};
 }
 async ownFile(id,file,draft,signal){
  if(file.sourceId||file.feedAsset)throw new AppError('INVALID');
  if(Boolean(file.draft)===draft)return file;
  const bytes=new WebsiteFileContent(this,undefined,null,file);
  const next={...file,...await this.descriptor(file.name,{content:bytes,contentType:file.contentType},{owner:siteOwner(id,draft),signal})};
  if(draft)next.draft=true;else delete next.draft;
  return next;
 }
 validBlob(file,id,sourceIds){
  const own=siteOwner(id,file.draft)+'/files/',source=typeof file.sourceId==='string'&&sourceIds.has(file.sourceId)?ROOT+'/sources/'+file.sourceId+'/files/':null;
  const base=file.blob?.startsWith(own)?own:source&&file.blob?.startsWith(source)?source:null;
  return base!==null&&file.blob.slice(base.length).startsWith(file.sha256+'.')&&/^[a-f0-9]{64}\.[a-z0-9]{1,12}$/.test(file.blob.slice(base.length));
 }
 validateManifest(value,id){
  if(value?.version!==1||value.id!==id||!hex(value.revision)||!Array.isArray(value.files)||!Array.isArray(value.pages)||!Array.isArray(value.sources))throw new AppError('FORMAT');
  if(value.canvasAssets!==undefined&&!hex(value.canvasAssets)||value.archived!==undefined&&value.archived!==true)throw new AppError('FORMAT');
  const sourceIds=new Set(value.sources.map(row=>row.id)),feedIds=new Set((value.feeds??[]).flatMap(feed=>feed.members.map(row=>row.id)));
  const names=new Map();for(const file of value.files){websiteFileName(file.name);if(names.has(file.name)||file.draft!==undefined&&file.draft!==true||!this.validBlob(file,id,file.feedAsset?feedIds:sourceIds)||!Number.isSafeInteger(file.size)||file.size<0||!hex(file.sha256)||typeof file.contentType!=='string')throw new AppError('FORMAT');names.set(file.name,file);}
  const pageIds=new Set();
  for(const page of value.pages){
   if(!names.has(page.path)||names.get(page.path).draft!==page.draft||!page.path.endsWith('.html')||!Array.isArray(page.placements))throw new AppError('FORMAT');
   if(page.archived!==undefined&&(page.archived!==true||!page.draft||page.path==='index.html'))throw new AppError('FORMAT');
   if(page.pageId!==undefined){if(!hex(page.pageId)||pageIds.has(page.pageId))throw new AppError('FORMAT');pageIds.add(page.pageId);}
  }
  if(!names.has('index.html')||names.get('index.html').draft)throw new AppError('FORMAT');
  validatePageStyles(value.pages,names);
  if(value.publicPageFiles!==undefined){
   if(!Array.isArray(value.publicPageFiles))throw new AppError('FORMAT');
   const seen=new Set();
   for(const {file,pin} of value.publicPageFiles){
    if(!file||!hex(pin)||!hex(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0||seen.has(file.name)||!names.has(file.name)||names.get(file.name).draft||file.draft||file.sourceId||!this.validBlob(file,id,new Set()))throw new AppError('FORMAT');
    seen.add(file.name);
   }
  }
  validateFeedFiles(value,names);
  validateSavedAppearance(value);
  validatePageDesigns(value);
  validateEditHistory(this,value,names);
  validateWebsiteThemes(value);
  validateStyleResources(value);
  checkComponentManifest(value,names);
  for(const source of value.sources)if(!hex(source.id)||!hex(source.revision))throw new AppError('FORMAT');return value;
 }
 async raw(id,{missing=false}={}){
  const site=siteName(id),head=await this.control(ROOT+'/sites/'+site+'/head.json',{missing});if(!head)return null;if(!hex(head.revision))throw new AppError('FORMAT');
  return this.revisionManifest(id,head.revision);
 }
 async revisionManifest(id,revision){
  const manifest=this.validateManifest(await this.control(ROOT+'/sites/'+siteName(id)+'/revisions/'+revision+'.json'),id);
  if(manifest.revision!==revision)throw new AppError('FORMAT');return manifest;
 }
 async siteAssets(local,placements,pages){
  const files=new Map(local.filter(file=>!file.sourceId).map(file=>[file.name,file]));
  const publicIds=assetSources(pages.filter(page=>!page.draft)),allIds=assetSources(pages);
  for(const placement of placements){
   if(!allIds.has(placement.id))continue;
   const source=await this.source(placement.id,{pending:true});
   if(!source||source.revision!==placement.revision||source.target!=='website')throw new AppError('CONFLICT');
   const all=allIds.get(source.id),published=publicIds.get(source.id);
   if(all.names.size){
    const available=new Set(source.assets.map(asset=>asset.name));
    for(const name of all.names)if(!available.has(name))throw new AppError('CONFLICT');
   }
   for(const asset of sourceFiles(source))if(all.all||all.names.has(asset.name))includeAsset(files,source,asset,!(published?.all||published?.names.has(asset.name)));
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
 async sourceDirectoryFilter(memberCount){
  const held=active.getStore();if(!held?.write||held.root!==this.workspace.root)throw new AppError('LOCKED');
  if(memberCount<64)return ()=>true;
  // Source directory names already contain cryptographic hashes. One directory
  // walk and two MiB of bits avoid negative network lookups for a large book.
  // A colliding prefix still requires an authenticated source/journal read.
  const bits=new Uint8Array(1<<21),prefix=id=>Number.parseInt(id.slice(0,6),16);
  await held.scope.member(this.absolute(ROOT+'/sources/sentinel'),async directory=>{
   if(!directory)return;
   for await(const entry of directory.entries())if(hex(entry.name)){
    const i=prefix(entry.name);bits[i>>>3]|=1<<(i&7);
   }
  },{missing:true});
  return id=>{const i=prefix(id);return Boolean(bits[i>>>3]&(1<<(i&7)));};
 }
 async fence(sourceId,set,signal,scope){
  if(!hex(sourceId))throw new AppError('INVALID');
  const entries=await this.pendingSources();if(set)entries.add(sourceId);else entries.delete(sourceId);
  if(set)await this.writeControl(pendingScopeFile(sourceId),scope??sourceFenceScope(null,null),{signal});
  if(entries.size)await this.writeControl(ROOT+'/pending.json',[...entries],{signal});else await this.remove(ROOT+'/pending.json');
  if(!set)await this.remove(pendingScopeFile(sourceId));
 }
 async current(id,revision,{archived=false}={}){
  const manifest=await this.raw(id);if(revision!==undefined&&revision!==manifest.revision)throw new AppError('CONFLICT');
  if(manifest.archived&&!archived)throw new AppError('NOT_FOUND');
  // A permission writer publishes this fence *before* changing research and
  // clears it only after every affected HTML/page manifest is committed. An
  // ordinary read checks one tiny file regardless of the number of sources.
  if((manifest.sources.length||manifest.feeds?.length)&&await siteHasPendingSources(this,manifest,await this.pendingSources()))throw new AppError('CONFLICT');
  if(manifest.pages.some(p=>!p.pageId))return {...manifest,pages:manifest.pages.map(p=>p.pageId?p:{...p,pageId:websitePageIdentity(id,p)})};
  return manifest;
 }
 site(manifest,page){
  const active=manifest.pages.filter(p=>!p.archived),archivedPages=manifest.pages.length-active.length;
  const archived=archivedPages?new Set(manifest.pages.filter(p=>p.archived).map(p=>p.path)):null;
  const feeds=manifest.feeds?.length?websiteFeedPages(manifest).filter(p=>!archived?.has(p.ownerPage)):null;
  return {id:manifest.id,name:manifest.name,revision:manifest.revision,pages:active.map(({path,title,draft})=>({path,title,...(draft?{draft:true}:{})})),...(feeds?.length?{feedPages:feeds}:{}),...(archivedPages?{archivedPages}:{}),cssPath:pageStylesheet(manifest,page)};
 }
 async commit(manifest,options={}){
  const {signal}=options;
  const previous=await this.raw(manifest.id,{missing:true});
  if(manifest.pages.some(p=>!p.pageId)){
   const old=new Map(previous?.pages.map(p=>[p.path,websitePageIdentity(manifest.id,p)]));
   manifest={...manifest,pages:manifest.pages.map(p=>p.pageId?p:{...p,pageId:old.get(p.path)??hash(randomUUID())})};
  }
  manifest=await syncEntryStyles(this,manifest,signal);
  manifest=await syncFeedShells(this,manifest,signal,reflowFeedShell);
  manifest=await syncSavedAppearance(this,manifest,signal);
  manifest=await syncWebsiteThemes(this,manifest,signal);
  manifest=await syncStyleResources(this,manifest,signal);
  manifest=retainWebsiteFeedAssets(manifest);
  const intents=manifest.pages.flatMap(p=>(p.sourceGalleries??[]).flatMap(g=>g.slots));
  if(intents.length){
   const refs=new Map(manifest.sources.map(row=>[row.id,row]));
   for(const {sourceId:id,revision} of intents){
    if(refs.has(id)&&refs.get(id).revision!==revision)throw new AppError('CONFLICT');
    refs.set(id,{id,revision});
   }
   manifest={...manifest,sources:[...refs.values()]};
  }
  manifest=retainComponentAssets(manifest);
  manifest=await preparePublicPageFiles(this,manifest,signal);
  if(manifest.feeds?.length)manifest={...manifest,feedPlacementsIndexed:2};
  const value={...manifest,...canvasStyles(manifest),version:1,updatedAt:new Date().toISOString(),updatedBy:this.versionActor};
  const history=Object.hasOwn(options,'history')?options.history:manifest.editHistory;
  delete value.editHistory;
  if(history?.expires>Date.now()){
   const page=value.pages.find(p=>p.path===history.page),live=new Set(value.files.map(f=>f.name));
   const files=page?history.files.filter(f=>!live.has(f.name)&&(page.draft||!f.draft)):[];
   if(files.length)value.editHistory={...history,files};
  }
  const stage=await beginVersionWrite(this,active.getStore().scope,value,previous,signal);
  let base=previous,oldIndex=stage.old,bootstrap;
  if(previous&&!previous.versionIndex){
   bootstrap=await prepareVersionRetention(this,previous,null,{signal,index:oldIndex,adopted:true});
   base={...previous,versionIndex:bootstrap.ref};oldIndex=undefined;
  }
  const retained=await prepareVersionRetention(this,value,base,{...options.versioning,signal,index:oldIndex});
  value.versionIndex=retained.ref;
  delete value.revision;value.revision=hash(plain(value));const directory=ROOT+'/sites/'+siteName(value.id);
  const bytes=Buffer.from(plain(value));if(bytes.length>CONTROL_LIMIT)throw new AppError('LIMIT');
  await writeFeedSubscription(this,value,previous,signal);
  // Direct copies retain their own per-source registrations. Feed-only
  // membership is registered as one ordered batch against this site head.
  const feedUsage=await prepareFeedUsage(this,previous,value,signal);
  const oldOrdinary=new Set(previous?.sources.map(source=>source.id)),newOrdinary=new Set(value.sources.map(source=>source.id));
  for(const id of newOrdinary)if(!oldOrdinary.has(id)){
   await this.writeControl(ROOT+'/sources/'+id+'/placements/'+siteName(value.id)+'.json',{siteId:value.id,sourceId:id},{signal});
  }
  await this.writeBytes(directory+'/revisions/'+value.revision+'.json',bytes,{signal});await this.writeControl(directory+'/head.json',{revision:value.revision,...(value.archived?{archived:true}:{})},{signal});
  await finishFeedUsage(this,feedUsage,signal);
  await clearFeedSubscription(this,value,previous);
  // Keep the previous index until ordinary resources have been collected so
  // an interrupted writer can resume from that small, durable pointer.
  for(const blob of retained.retired)if(blob!==previous?.versionIndex?.blob)await this.remove(blob);
  if(previous?.versionIndex&&retained.retired.includes(previous.versionIndex.blob))await this.remove(previous.versionIndex.blob);
  if(previous&&previous.revision!==value.revision){
   for(const id of oldOrdinary)if(!newOrdinary.has(id))await this.remove(ROOT+'/sources/'+id+'/placements/'+siteName(value.id)+'.json');
   await this.remove(directory+'/revisions/'+previous.revision+'.json');
  }
  await this.remove(stage.journal);return value;
 }
 async readText(descriptor,{signal}={}){if(descriptor.size>TEXT_LIMIT)throw new AppError('LIMIT');const parts=[];for await(const bytes of new WebsiteFileContent(this,undefined,null,descriptor).read(0,descriptor.size-1,{signal}))parts.push(bytes);return Buffer.concat(parts).toString('utf8');}
 async scripts(files){const allowed=new Set();for(const descriptor of files)if(descriptor.name.endsWith('.js')){assertPublicFiles(new Map([[descriptor.name,await this.readText(descriptor)]]));allowed.add(descriptor.name);}return allowed;}
 async present(manifest,page='index.html',{signal}={}){
  if(manifest.pages.some(p=>p.path===page&&p.archived))throw new AppError('NOT_FOUND');
  websiteFileName(page);const selected=manifest.files.find(file=>file.name===page),site=this.site(manifest,manifest.pages.find(p=>p.path===page)),css=manifest.files.find(file=>file.name===site.cssPath);if(!selected||selected.feedPage||!page.endsWith('.html'))throw new AppError('NOT_FOUND');
  const html=await this.readText(selected,{signal}),legacy=selected.entryStyle!==entryStyleHash;
  const assetStamp=this.assetStamp(manifest,page);
  const styles=css?await this.readText(css,{signal}):'';
  let protectedFiles;
  if(manifest.sources.length||manifest.feeds?.length){
   const names=new Set([...(selected.references??websiteFileReferences(html,page)),...(css?.references??(css?websiteFileReferences(styles,css.name):[]))].map(r=>r.name.toLowerCase()));
   protectedFiles=manifest.files.filter(f=>(f.sourceId||f.feedAsset||f.feedPage)&&names.has(f.name.toLowerCase())).map(f=>f.name);
  }
  const owner=manifest.pages.find(p=>p.path===page);
  return {site,path:page,pageId:owner&&websitePageIdentity(manifest.id,owner),updatedBy:manifest.updatedBy,protectedFiles,assetStamp,surfaceStamp:this.surfaceStamp(manifest,page,assetStamp),sourceStamp:this.sourceStamp(manifest,page),html:legacy?styledPageHTML(html,page).html:html,css:styles};
 }
 sourceStamp(manifest,page){
  const feeds=manifest.feeds?.filter(f=>f.path===page).flatMap(f=>f.groups.map(g=>g.stamp))??[];
  return hash(plain(feeds.length?[manifest.sources,feeds]:manifest.sources));
 }
 assetStamp(manifest,page){
  return (page&&manifest.pages.find(p=>p.path===page)?.canvasStyles?.stamp)||manifest.canvasAssets||canvasAssetStamp(manifest);
 }
 surfaceStamp(manifest,page,assetStamp=this.assetStamp(manifest,page)){
  const file=manifest.files.find(f=>f.name===page);if(!file)return null;
  const grants=manifest.sources.map(s=>[s.id,s.revision]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  return hash(plain([fileIdentity(file),assetStamp,grants,manifest.feeds?.filter(feed=>feed.path===page).map(feed=>feed.groups.map(g=>g.stamp))??[]]));
 }
 list({limit=25,after=null,archived=false,signal}={}){return this.scope(async()=>{
  if(!Number.isInteger(limit)||limit<1||limit>100||typeof archived!=='boolean')throw new AppError('INVALID');
  const items=[],pending=await this.pendingSources(),cache=new Map();let cursor=after,last=null;
  do{
   const batch=await this.names(ROOT+'/sites',{after:cursor,limit:Math.min(limit+1,100)});cursor=batch.next;
   for(const name of batch.items){
    signal?.throwIfAborted();const head=await this.control(ROOT+'/sites/'+name+'/head.json',{missing:true,limit:1024});
    if(!head||Boolean(head.archived)!==archived)continue;
    if(items.length===limit)return {items,next:last};
    const manifest=await this.revisionManifest(name==='default'?null:name,head.revision);
    const item=archived?{id:manifest.id,name:manifest.name,revision:manifest.revision}:this.site(manifest);
    if(await siteHasPendingSources(this,manifest,pending,cache)){item.pages=[];delete item.feedPages;item.pending=true;}
    items.push(item);last=name;
   }
  }while(cursor);
  return {items,next:null};
 },{signal});}
 create({id=randomUUID(),name,html,css,language,signal}={}){
  name=title(name);
  css??=html==null?starterStyles:'';
  html??=starterPage({title:name,stylesheet:'style.css',language},escapeWebsiteText);
  return this.importFiles(id,{name,files:new Map([['index.html',html],['style.css',css]]),signal});
 }
 importFiles(id,{name,files,draftFiles=new Map(),expectedRevision,signal,onFile}={}){return this.scope(async()=>{
  siteName(id);name=title(name);if(!(files instanceof Map)||!files.has('index.html'))throw new AppError('INVALID');const previous=await this.raw(id,{missing:true});
  if(previous?expectedRevision!==previous.revision:expectedRevision!==undefined)throw new AppError(previous?'CONFLICT':'NOT_FOUND');
  if(!(draftFiles instanceof Map)||[...draftFiles.keys()].some(name=>files.has(name))||draftFiles.size&&!draftFiles.has(sharedDraftStyle))throw new AppError('INVALID');
  const descriptors=[];for(const members of [files,draftFiles])for(const [name,value] of members){
   signal?.throwIfAborted();descriptors.push(await this.siteFile(id,name,value,{draft:members===draftFiles,signal}));
   await onFile?.(descriptors.length,files.size+draftFiles.size);
  }
  const scripts=await this.scripts(descriptors),pages=[],sources=new Map();
  for(const descriptor of descriptors){if(descriptor.name.endsWith('.html')){const html=await this.readText(descriptor,{signal});validateWebsiteHTML(html,{scripts,file:descriptor.name});const placements=websiteSourcePlacements(html);pages.push({path:descriptor.name,title:websiteDocumentTitle(html),placements,...(descriptor.draft?{draft:true}:{})});for(const source of placements)sources.set(source.id,source);}else if(descriptor.name.endsWith('.css'))validateWebsiteCSS(await this.readText(descriptor,{signal}),{file:descriptor.name});}
  const placements=[...sources.values()],candidate={id,name,pages,cssPath:files.has('style.css')?'style.css':files.has('styles.css')?'styles.css':'style.css',files:await this.siteAssets(descriptors,placements,pages),sources:placements};await this.assertSources(candidate);
  return this.present(await this.commit(candidate,{signal}),'index.html',{signal});
 },{write:true,signal});}
 open(id,{path:page='index.html',signal}={}){return this.scope(async()=>this.present(await this.current(id),page,{signal}),{signal});}
 menu(id,options){return readSiteMenu(this,id,options);}
 saveMenu(id,options){return saveSiteMenu(this,id,options);}
 async inspectPageSource(manifest,page,html,css,signal,designInstances,creation){
  if(manifest.pages.some(p=>p.path===page&&p.archived))throw new AppError('NOT_FOUND');
  websiteFileName(page);if(!page.endsWith('.html'))throw new AppError('INVALID');
  if(manifest.files.some(file=>file.name===page&&file.feedPage))throw new AppError('CONFLICT');
  const former=manifest.pages.find(item=>item.path===page),placements=websiteSourcePlacements(html,former?.placements);
  const draft=former?.draft||creation?.draft,cssPath=creation?.stylePath??pageStylesheet(manifest,former);
  const scripts=await this.scripts(manifest.files),htmlPictures=new Set(),cssPictures=new Set(),recordingNames=new Set();
  const addViewer=!scripts.has('public-gallery.js')&&typeof html==='string'&&html.includes('public-gallery.js');
  if(addViewer)scripts.add('public-gallery.js');
  validateWebsiteHTML(html,{scripts,file:page,pictures:htmlPictures,recordings:recordingNames});validateWebsiteCSS(css,{file:cssPath,pictures:cssPictures});
  if(former?.placements.length||placements.length||former?.sourceGalleries?.length||manifest.feeds?.some(f=>f.path===page)||html.includes('data-website-feed')){
   const old=manifest.files.find(file=>file.name===page);const previous=old?await this.readText(old,{signal}):'';
   if(plain(websiteMarkerShape(previous))!==plain(websiteMarkerShape(html)))throw new AppError('CONFLICT');
  }
  if(designInstances&&former)throw new AppError('CONFLICT');
  checkSavedComponents(manifest,designInstances?{path:page,instances:designInstances}:former,html);
  return {former,placements,draft,cssPath,scripts,htmlPictures,cssPictures,recordingNames,addViewer};
 }
 createPage(id,{expectedRevision,path:page,title:pageTitle,language,inclusion='private',signal},design){return this.scope(async()=>{
  if(!hex(expectedRevision)||!['private','included'].includes(inclusion))throw new AppError('INVALID');
  websiteFileName(page);pageTitle=title(pageTitle);
  const manifest=await this.current(id,expectedRevision);
  if(!page.endsWith('.html'))throw new AppError('CONFLICT');
  assertPageDestination(manifest,page,'CONFLICT');
  const stylePath=newPageStylesheet(manifest),baseStyle=sourceURL(page,manifest.cssPath);
  const html=addPageStyle(design?.html??starterPage({title:pageTitle,stylesheet:baseStyle,language},escapeWebsiteText),page,stylePath);
  return this.save(id,{expectedRevision,path:page,html,css:design?.css??'',title:pageTitle,signal},design?.instances,{stylePath,styleTokens:design?.styleTokens,draft:inclusion==='private'||undefined});
 },{write:true,signal});}
 save(id,{expectedRevision,path:page='index.html',html,css,title:pageTitle,receivePictures,recordings,historyKey,recovery,signal}={},designInstances,creation,restoration){return this.scope(async()=>{
  if(!hex(expectedRevision))throw new AppError('INVALID');
  let manifest=await this.current(id,expectedRevision);
  if(restoration){
   const files=new Map(manifest.files.map(f=>[f.name,f]));
   for(const f of restoration.resources)files.set(f.name,f);
   const pages=manifest.pages.map(p=>p.path===page?{...p,instances:restoration.instances}:p);
   manifest={...manifest,files:[...files.values()],pages};
  }
  if(!creation&&!manifest.pages.some(p=>p.path===page))throw new AppError('NOT_FOUND');
  const inspected=await this.inspectPageSource(manifest,page,html,css,signal,designInstances,creation);
  const {former,draft,cssPath,scripts,htmlPictures,cssPictures,recordingNames,addViewer}=inspected,sources=new Map();
  let {placements}=inspected;
  if(!former){
   ({html,placements}=await inheritSiteMenu(this,manifest,html,page,placements,{signal}));
   validateWebsiteHTML(html,{scripts,file:page,pictures:htmlPictures,recordings:recordingNames});
  }
  const historyFiles=editHistory(manifest,historyKey,page);
  const files=manifest.files.filter(file=>file.name!==page&&file.name!==cssPath);
  for(const file of historyFiles)if(htmlPictures.has(file.name)||cssPictures.has(file.name)||recordingNames.has(file.name))files.push(file);
  files.push(await this.siteFile(id,page,html,{signal,draft}),await this.siteFile(id,cssPath,css,{signal,draft}));
  if(addViewer)files.push(await this.siteFile(id,'public-gallery.js',PUBLIC_GALLERY_SCRIPT,{signal}));
  if(html.includes('public-gallery.css')&&!files.some(file=>file.name==='public-gallery.css')){
   const viewerCSS=await readFile(new URL('./web/public-gallery.css',import.meta.url),'utf8');files.push(await this.siteFile(id,'public-gallery.css',viewerCSS,{signal}));
  }
  const pages=manifest.pages.filter(value=>value.path!==page);pages.push({path:page,title:pageTitle?title(pageTitle):websiteDocumentTitle(html),placements,pictures:[...htmlPictures],recordings:[...recordingNames],...(draft?{draft:true}:{})});
  if(creation?.stylePath||former?.stylePath)pages.at(-1).stylePath=creation?.stylePath??former.stylePath;
  if(former?.sharedDraftBase)pages.at(-1).sharedDraftBase=true;
  if(designInstances?.length||former?.instances?.length)pages.at(-1).instances=designInstances??former.instances;
  if(former?.sourceGalleries?.length)pages.at(-1).sourceGalleries=former.sourceGalleries;
  if(former?.entryDisplays)pages.at(-1).entryDisplays=former.entryDisplays;
  for(const value of pages)for(const source of value.placements)sources.set(source.id,source);
  const candidate={...manifest,files,pages,sources:[...sources.values()]};
  if(creation?.styleTokens?.length)candidate.styleBook={...manifest.styleBook,pages:{...manifest.styleBook.pages,[page]:creation.styleTokens}};
  await this.assertSources(candidate);
  const recovered=recovery?await recoveryAssets(this,manifest,page,recovery,new Set([...htmlPictures,...cssPictures]),recordingNames):null;
  async function* savedPictures(){
   yield* recovered.pictures;
   if(receivePictures)yield* receivePictures();
  }
  const pictures=await saveWebsitePictures(this,manifest,{files,pages,page,style:cssPath,htmlPictures,cssPictures,receivePictures:recovery?savedPictures:receivePictures,draft,signal});
  let saved,media,retention;try{
   const uploads=recovered?.recordings.length?[...recovered.recordings,...(recordings??[])]:recordings;
   media=await saveWebsiteRecordings(this,manifest,{files:pictures.files,pages,names:recordingNames,uploads,draft,signal});
   retention=retainEditHistory(manifest,media.files,historyKey,page);
   saved=await this.commit({...candidate,files:media.files,pictureStyles:pictures.pictureStyles},{signal,history:retention.history,...(restoration?{versioning:{restoredFrom:restoration.version}}:{})});
  }catch(error){if((await this.raw(id)).revision===manifest.revision){await pictures.rollback();await media?.rollback();}throw error;}
  const result=await this.present(saved,page,{signal});
  if(retention.history)result.historyAssetStamp=editHistoryStamp(saved);
  return result;
 },{write:true,signal});}
 checkRevision(id,revision){return this.scope(async()=>this.site(await this.current(id,revision)));}
 canvasDocument(id,page,token,{signal}={}){return this.scope(async()=>{
  const manifest=await this.current(id);
  if(!hex(token)||manifest.revision!==token&&this.assetStamp(manifest,page)!==token&&editHistoryStamp(manifest)!==token)throw new AppError('CONFLICT');
  if(!manifest.pages.some(p=>p.path===page&&!p.archived))throw new AppError('NOT_FOUND');
 },{signal});}
 siteVersion(id,options={}){return this.versionStatus(id,options).then(value=>value.revision);}
 versionStatus(id,{path,expectedRevision,historyKey,media,signal}={}){return this.scope(async()=>{
  const head=await this.control(ROOT+'/sites/'+siteName(id)+'/head.json',{limit:1024});
  if(!hex(head?.revision))throw new AppError('FORMAT');
  if(head.archived)throw new AppError('NOT_FOUND');
  const pending=await this.pendingSources(),changed=path&&expectedRevision!==head.revision;
  if(media!==undefined&&(!Array.isArray(media)||media.some(n=>typeof n!=='string'||!n.startsWith('pictures/')&&!n.startsWith('recordings/'))))throw new AppError('INVALID');
  if(!changed&&!pending.size&&!media?.length)return head;
  const manifest=await this.revisionManifest(id,head.revision);
  if(await siteHasPendingSources(this,manifest,pending))throw new AppError('CONFLICT');
  if(!changed){
   if(!media?.length)return head;
   const page=manifest.pages.find(p=>p.path===path);
   const held=editHistory(manifest,historyKey,path);
   const admitted=new Set([...manifest.files,...held].filter(file=>!file.sourceId&&!file.feedAsset&&(page?.draft||!file.draft)).map(file=>file.name));
   return {...head,mediaAvailable:!!page&&media.every(name=>admitted.has(name)),...(held.length?{historyAssetStamp:editHistoryStamp(manifest)}:{})};
  }
  return {...head,surfaceStamp:this.surfaceStamp(manifest,path),site:this.site(manifest,manifest.pages.find(p=>p.path===path))};
 },{signal});}
 withSite(id,revision,operation){return this.scope(async()=>{const manifest=await this.current(id,revision);return operation(this.site(manifest));},{write:true});}
 file(id,name,{revision,signal,editor=false}={}){return this.scope(async()=>{
  websiteFileName(name);
  const follow=editor&&hex(revision)&&!name.endsWith('.html');
  const manifest=await this.current(id,follow?undefined:revision),historyAccess=follow&&editHistoryStamp(manifest)===revision;
  const original=manifest.files.find(file=>file.name===name)??(historyAccess&&manifest.editHistory.expires>Date.now()?manifest.editHistory.files.find(file=>file.name===name):null);
  const descriptor=(!editor&&manifest.publicPageFiles?.find(row=>row.file.name===name)?.file)||original;
  if(editor&&name.endsWith('.html')){
   const host=original?.feedPage?manifest.feeds?.find(f=>f.id===original.feedPage)?.path:name;
   if(manifest.pages.some(p=>p.path===host&&p.archived))throw new AppError('NOT_FOUND');
  }
  if(follow&&manifest.revision!==revision&&!historyAccess){
   const owned=original?.tokenSheet||original?.tokenFont||manifest.pages.some(page=>page.stylePath===name);
   const allowed=!owned&&this.assetStamp(manifest)===revision||manifest.pages.some(page=>page.canvasStyles?.stamp===revision&&(!owned||page.canvasStyles.all||page.canvasStyles.members.includes(name)));
   if(!allowed)throw new AppError('CONFLICT');
  }
  if(name===entryStyleName&&(!descriptor||descriptor.draft&&!editor)){
   const files=new Map(manifest.files.map(f=>[f.name,f]));
   for(const page of manifest.pages)if((editor||!page.draft)&&(usesEntryStyle(page)||await fileHasEditorMenu(this,files.get(page.path),signal))){
    await this.current(id,manifest.revision);return {bytes:Buffer.from(entryCSS),contentType:'text/css; charset=utf-8',revision:manifest.revision,sha256:entryStyleHash,size:Buffer.byteLength(entryCSS)};
   }
  }
  if(!descriptor||editor!==true&&(descriptor.draft||descriptor.picture&&!publicPictureNames(manifest).has(name)||descriptor.recording&&!publicRecordingNames(manifest).has(name)))throw new AppError('NOT_FOUND');
  const legacy=descriptor.entryStyle!==entryStyleHash&&name.endsWith('.html')&&(usesEntryStyle(manifest.pages.find(p=>p.path===name))||await fileHasEditorMenu(this,descriptor,signal));
  const blocked=!editor&&manifest.publicPageFiles===undefined&&/\.(?:html|css)$/.test(name)?privateWebsiteNames(manifest):null;
  const content=legacy||blocked?.size?await RenderedWebsiteFile.open(this,manifest,descriptor,signal,blocked):new WebsiteFileContent(this,id,manifest.revision,descriptor);
  return {content,contentType:descriptor.contentType,revision:manifest.revision,size:content.size,sha256:content.sha256};
 },{signal});}
 export(id,{expectedRevision,signal}={}){return this.scope(async()=>{
  const manifest=await this.current(id,expectedRevision),{site,descriptors,styles}=await this.publicationFiles(manifest,signal,true);
  const files=new Map([...descriptors].map(([name,file])=>[name,new WebsiteFileContent(this,id,manifest.revision,file)]));
  if(styles.length&&!files.has(entryStyleName))files.set(entryStyleName,Buffer.from(entryCSS));
  for(const file of styles)if(file.entryStyle!==entryStyleHash)files.set(file.name,await RenderedWebsiteFile.open(this,manifest,file,signal));
  if(manifest.publicPageFiles===undefined){
   const blocked=privateWebsiteNames(manifest);
   if(blocked.size)for(const [name,file] of descriptors)if(/\.(?:html|css)$/.test(name))files.set(name,await RenderedWebsiteFile.open(this,manifest,file,signal,blocked));
  }
  return {revision:manifest.revision,site,files};
 },{signal});}
 publicationInventory(id,{expectedRevision,signal}={}){return this.scope(async()=>{
  const manifest=await this.current(id,expectedRevision),{site,descriptors,styles}=await this.publicationFiles(manifest,signal,false);
  const names=[...descriptors.keys()];if(styles.length&&!descriptors.has(entryStyleName))names.push(entryStyleName);
  return {revision:manifest.revision,pages:[...site.pages,...(site.feedPages??[])],files:names};
 },{signal});}
 async publicationFiles(manifest,signal,renderPages){
  const descriptors=new Map(),styles=[],pictures=publicPictureNames(manifest),recordings=publicRecordingNames(manifest);
  const publicPages=manifest.pages.filter(page=>!page.draft),publicPaths=new Set(publicPages.map(p=>p.path));
  if(manifest.feeds?.some(feed=>feed.unavailable==='capacity'&&publicPaths.has(feed.path)))throw new AppError('WEBSITE_FEED_CAPACITY');
  for(const file of manifest.files)if(!file.draft&&(!file.entryDisplaySheet||file.name===entryStyleName)&&(!file.picture||pictures.has(file.name))&&(!file.recording||recordings.has(file.name)))descriptors.set(file.name,file);
  for(const row of manifest.publicPageFiles??[])if(descriptors.has(row.file.name))descriptors.set(row.file.name,row.file);
  for(const page of publicPages){
   // A names-only review needs to know whether the shared stylesheet exists.
   // Only the export needs to prepare the individual pages that use it.
   if(!renderPages&&(styles.length||descriptors.has(entryStyleName)))break;
   const file=descriptors.get(page.path);
   if(usesEntryStyle(page)||await fileHasEditorMenu(this,file,signal))styles.push(file);
  }
  return {site:this.site({...manifest,pages:publicPages,feeds:manifest.feeds?.filter(f=>publicPaths.has(f.path))}),descriptors,styles};
 }
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
 searchLibrary(options={}){return this.scope(scope=>searchWebsiteLibrary(this,scope,options),options);}
 previewSource({sourceId,sourceRevision,sectionAfter,signal}={}){return this.scope(()=>previewWebsiteSource(this,sourceId,sourceRevision,signal,sectionAfter),{signal});}
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
 pdfVersion({signal}={}){return this.scope(async()=>{
  const revision=await this.control(ROOT+'/pdf-version.json',{missing:true,limit:128});
  if(revision!==null&&!uuid(revision))throw new AppError('FORMAT');
  return revision;
 },{signal});}
 advancePdfVersion(signal){return this.writeControl(ROOT+'/pdf-version.json',randomUUID(),{signal});}
 beginSourceUpdate({sourceId,target,provenance,signal,ifAbsent=false,resumeSeed=false,reviveRevision,tagsOnly=false,liveOnly=false,policySignature,tagsRevision,feedBackfill=false,feedRemoval=false}={}){return this.scope(async()=>{
  if(!hex(sourceId)||target!==undefined&&!['website','pdf'].includes(target))throw new AppError('INVALID');
  const path=ROOT+'/sources/'+sourceId+'/pending.json',token=randomUUID(),saved=await this.control(path,{missing:true});
  const previous=saved?saved.previous:await this.source(sourceId,{pending:true}),known=saved?.target??previous?.target;
  if(target&&known&&target!==known)throw new AppError('CONFLICT');
  if(resumeSeed&&(!ifAbsent||target!=='website'))throw new AppError('INVALID');
  if(reviveRevision!==undefined&&(!resumeSeed||!hex(reviveRevision)||previous?.visible!==false||previous.revision!==reviveRevision))throw new AppError('CONFLICT');
  const seed=resumeSeed&&saved?.seed===true&&(saved.previous===null||reviveRevision!==undefined);
  if(ifAbsent&&!seed&&(saved||previous&&reviveRevision===undefined||(await this.pendingSources()).has(sourceId)))throw new AppError('EXISTS');
  target??=known;
  const journal={token,previous,target,startedAt:saved?.startedAt??new Date().toISOString(),recovered:Boolean(saved),...(resumeSeed?{seed:true}:{}),...(tagsOnly&&(!saved||saved.tagsOnly)?{tagsOnly:true}:{})};
  if(liveOnly&&(!saved||saved.liveOnly))journal.liveOnly=true;
  if(feedBackfill&&(!saved||saved.feedBackfill))journal.feedBackfill=true;
  if(feedRemoval&&journal.liveOnly&&(!saved||saved.feedRemoval))journal.feedRemoval=true;
  const policy=saved?saved.policySignature:policySignature;
  if(hex(policy)){journal.policySignature=policy;journal.tagsRevision=saved?saved.tagsRevision??null:tagsRevision??null;}
  // An absent source has no placements. Record bootstrap ownership first so
  // a crash cannot leave an anonymous fence which no writer may safely adopt.
  const owner=provenance??previous?.provenance;
  if(owner&&websiteSourceId({...owner,target})!==sourceId)throw new AppError('INVALID');
  if(ifAbsent&&resumeSeed)await this.writeControl(path,journal,{signal});
  // Read-only reconciliation can replace a feed overlay without changing a
  // manually inserted entry. Any later permission writer widens this fence
  // before making the research change. Unscoped journals remain restrictive.
  await this.fence(sourceId,true,signal,sourceFenceScope(target,owner,journal.feedBackfill&&journal.liveOnly&&!journal.feedRemoval));
  if(!(ifAbsent&&resumeSeed))await this.writeControl(path,journal,{signal});
  if(target==='pdf')await this.advancePdfVersion(signal);
  return token;
 },{write:true,signal});}
 async finishSourceUpdate(sourceId,target,signal,seed=false){
  if(seed)await this.fence(sourceId,false,signal);
  await this.remove(ROOT+'/sources/'+sourceId+'/pending.json');
  if(!seed)await this.fence(sourceId,false,signal);
  if(target==='pdf')await this.advancePdfVersion(signal);
 }
 cancelSourceUpdate({sourceId,token,signal}={}){return this.scope(async()=>{
  if(!hex(sourceId)||!uuid(token))throw new AppError('INVALID');
  const pending=await this.control(ROOT+'/sources/'+sourceId+'/pending.json'),current=await this.source(sourceId,{pending:true});
  if(pending.recovered||pending.token!==token||(current?.revision??null)!==(pending.previous?.revision??null))throw new AppError('CONFLICT');
  await this.finishSourceUpdate(sourceId,pending.target??current?.target,signal,pending.seed);
 },{write:true,signal});}
 putSource({sourceId,title:sourceTitle,html='',css='',assets=[],provenance,pickerContext,pdfParts=null,visible=true,target='website',signal}={}, {token}={}){return this.scope(async()=>{
  if(!hex(sourceId)||!uuid(token)||typeof visible!=='boolean'||!['website','pdf'].includes(target))throw new AppError('INVALID');const directory=ROOT+'/sources/'+sourceId,pending=await this.control(directory+'/pending.json');if(pending.token!==token||pending.target&&pending.target!==target)throw new AppError('CONFLICT');
  if(pending.feedBackfill&&pending.liveOnly)throw new AppError('CONFLICT');
  if(!pending.target&&target==='pdf'){await this.writeControl(directory+'/pending.json',{...pending,target},{signal});await this.advancePdfVersion(signal);}
  sourceTitle=title(sourceTitle);validateWebsiteHTML('<!doctype html><html><head><title>Content</title></head><body>'+html+'</body></html>');validateWebsiteCSS(css);
  if(provenance&&websiteSourceId({...provenance,target})!==sourceId)throw new AppError('INVALID');
  const prior=pending.previous,previousHtml=prior?await this.readText(prior.html,{signal}):'',files=[];
  if(visible)for(const asset of assets){if(!/^assets\/[a-f0-9]{64}\.[a-z0-9]{1,12}$/.test(asset.path??''))throw new AppError('INVALID');const descriptor=await this.descriptor(asset.path,asset,{signal,owner:directory});if(asset.path.slice(7,71)!==descriptor.sha256)throw new AppError('MEDIA_INVALID');files.push(descriptor);}
  const source={id:sourceId,title:sourceTitle,target,visible,provenance,html:await this.descriptor('fragment.html',visible?html:'',{signal,owner:directory}),css:await this.descriptor('source.css',visible?css:'',{signal,owner:directory}),assets:files};if(visible&&target==='pdf'){if(!pdfParts||pdfParts.version!==1)throw new AppError('PDF_SOURCE_CONTENT');source.pdfParts=await this.descriptor('composition.json',plain(pdfParts),{signal,owner:directory});}source.revision=hash(plain(source));
  return this.#commitSource(source,html,previousHtml,pending,pickerContext,signal);
 },{write:true,signal});}
 updateSourceTags(sourceId,{tags,provenance,pickerContext,token,signal,liveOutput}){return this.scope(async()=>{
  if(!hex(sourceId)||!uuid(token))throw new AppError('INVALID');
  const directory=ROOT+'/sources/'+sourceId,pending=await this.control(directory+'/pending.json'),prior=pending.previous;
  if(pending.feedBackfill&&pending.liveOnly)throw new AppError('CONFLICT');
  if(pending.token!==token||!prior?.visible||prior.target!==provenance.target||websiteSourceId(provenance)!==sourceId)throw new AppError('CONFLICT');
  const previousHtml=await this.readText(prior.html,{signal}),html=replaceSourceTags(previousHtml,tags);
  const source={...prior,provenance,html:await this.descriptor('fragment.html',html,{signal,owner:directory})};delete source.revision;
  source.revision=hash(plain(source));
  return this.#commitSource(source,html,previousHtml,pending,pickerContext,signal,tags,liveOutput);
 },{write:true,signal});}
 async #commitSource(source,html,previousHtml,pending,pickerContext,signal,tags,liveOutput){
  const {id:sourceId,target,visible,provenance}=source,directory=ROOT+'/sources/'+sourceId,prior=pending.previous;
  await this.writeControl(directory+'/head.json',source,{signal});if(provenance)await this.writeControl(recordIndex(provenance.workspaceId,provenance.recordId,target),{sourceId},{signal});
  const indexed=await indexWebsiteSource(this,source,html,signal,pickerContext);
  const {live,retired,retained}=await synchronizeFeedSource(this,source,{tags,liveOutput,previous:prior,context:pickerContext,row:indexed,signal});
  let galleryItems,displayChoices,after=null;do{const sites=await this.names(directory+'/placements',{after,limit:25,directories:false});for(const member of sites.items){
   signal?.throwIfAborted();const row=await this.control(directory+'/placements/'+member);if(row.sourceId!==sourceId||siteName(row.siteId)+'.json'!==member)throw new AppError('FORMAT');
   if(row.feedOnly)continue;
   const id=row.siteId,manifest=await this.raw(id,{missing:true});if(!manifest?.sources.some(value=>value.id===sourceId))continue;
   const pages=new Map(manifest.pages.map(page=>[page.path,page]));
   const nextFiles=[];for(const descriptor of manifest.files){
    const page=pages.get(descriptor.name);
    const hasSlots=page?.sourceGalleries?.some(group=>group.slots.some(slot=>slot.sourceId===sourceId));
    if(hasSlots||page?.placements.some(item=>item.id===sourceId)){
     if(visible&&hasSlots)galleryItems??=sourceGalleryItems(html,source.assets);
     if(visible&&page.placements.some(p=>p.id===sourceId&&p.display))displayChoices??=entryDisplayChoices(html);
     const original=await this.readText(descriptor,{signal}),ordinary=updateWebsiteSource(original,{id:sourceId,revision:source.revision,previousHtml:atPage(previousHtml,descriptor.name),html:atPage(html,descriptor.name),visible,placements:page.placements,entryDisplays:page.entryDisplays,displayChoices,page:page.path,title:source.title});
     const {html:updated,groups}=refreshSourceGalleries(ordinary,page,sourceId,source.revision,galleryItems);
     if(updated!==original||hasSlots)pages.set(page.path,{...page,title:websiteDocumentTitle(updated),placements:websiteSourcePlacements(updated,page.placements),...(groups.length?{sourceGalleries:groups}:{})});
     nextFiles.push(updated===original?descriptor:await this.siteFile(id,descriptor.name,updated,{signal,draft:descriptor.draft}));
    }
    else if(descriptor.sourceId!==sourceId)nextFiles.push(descriptor);
   }
   const nextPages=[...pages.values()],sources=[...new Map(nextPages.flatMap(page=>page.placements.map(({id,revision})=>[id,{id,revision}]))).values()];
   await this.commit({...manifest,pages:nextPages,files:await this.siteAssets(nextFiles,sources,nextPages),sources},{signal});
  }after=sites.next;}while(after!==null);
  await refreshFeedSubscriptions(this,live,{signal});
  await releasePreviousFeedSource(this,retired,retained,signal);
  if(prior){for(const file of [prior.html,prior.css,...prior.assets,...(prior.pdfParts?[prior.pdfParts]:[])])if(!retained.has(file.blob))await this.remove(file.blob);}
  await this.finishSourceUpdate(sourceId,target,signal,pending.seed);return {id:sourceId,title:source.title,revision:source.revision,visible,target};
 }
 insertSource(id,{sourceId,sourceRevision,...options}={}){return this.insertSources(id,{...options,sources:[{sourceId,sourceRevision}]},{requirePins:false});}
 insertSources(id,{expectedRevision,path:page='index.html',sources,position='end',presentation='full',signal}={}, {requirePins=true}={}){return this.scope(async()=>{
  if(!['full','card'].includes(presentation)||!hex(expectedRevision)||!Array.isArray(sources)||!sources.length||sources.length>40||sources.some(row=>!hex(row?.sourceId)||(requirePins||row.sourceRevision!==undefined)&&!hex(row.sourceRevision))||new Set(sources.map(row=>row.sourceId)).size!==sources.length)throw new AppError('INVALID');
  const manifest=await this.current(id,expectedRevision),destination=manifest.pages.find(row=>row.path===page);
  if(!destination)throw new AppError('NOT_FOUND');
  const files=new Map(manifest.files.map(file=>[file.name,file])),body=await this.readText(files.get(page),{signal});
  const placements=new Map(manifest.sources.map(row=>[row.id,row])),entries={...destination.entryDisplays},fragments=[],styles=[];let bytes=Buffer.byteLength(body);
  for(const {sourceId,sourceRevision} of sources){
   signal?.throwIfAborted();const source=await this.source(sourceId);
   if(!source?.visible||source.target!=='website')throw new AppError('NOT_FOUND');
   if(sourceRevision!==undefined&&source.revision!==sourceRevision)throw new AppError('CONFLICT');
   placements.set(sourceId,{id:sourceId,revision:source.revision});
   if(presentation==='card'){
    const slot=randomUUID(),display={id:sourceId,slot,presentation,choice:'title'};entries[slot]=display;
    fragments.push({id:sourceId,revision:source.revision,title:source.title,display});continue;
   }
   bytes+=source.html.size;if(bytes>TEXT_LIMIT)throw new AppError('LIMIT');
   fragments.push({id:sourceId,revision:source.revision,html:atPage(await this.readText(source.html,{signal}),page)});
   for(const asset of sourceFiles(source))includeAsset(files,source,asset,Boolean(destination.draft));
   const href=sourceURL(page,styleName(sourceId));if(!body.includes('href="'+href+'"'))styles.push('<link rel="stylesheet" href="'+href+'">');
  }
  let html=insertWebsiteSources(body,fragments,position);if(styles.length)html=html.replace(/<\/head\s*>/i,styles.join('')+'</head>');
  if(Buffer.byteLength(html)>TEXT_LIMIT)throw new AppError('LIMIT');
  const pages=manifest.pages.map(row=>row===destination?{...row,placements:websiteSourcePlacements(html,row.placements),...(presentation==='card'?{entryDisplays:entries}:{})}:row);
  files.set(page,await this.siteFile(id,page,html,{signal,draft:destination.draft}));
  const saved=await this.commit({...manifest,files:[...files.values()],sources:[...placements.values()],pages},{signal});
  return this.present(saved,page,{signal});
 },{write:true,signal});}
 publicationWorkspace(id){
  siteName(id);const store=this,base=this.workspace,prefix=ROOT+'/sites/'+siteName(id)+'/publication';
  const relative=name=>{if(typeof name!=='string'||!name.startsWith('.observanda/'))throw new AppError('UNSAFE');websiteFileName(name.slice(12));return prefix+'/'+name.slice(12);};
  return {root:base.root,vault:base.vault,websiteId:id,websiteContext:true,baseWorkspace:base,
   withLock:operation=>store.scope(()=>operation(),{write:true}),
   async deploymentOwnerId(){const {websiteDeploymentOwner}=await import('./website-publishing-migration.js');return websiteDeploymentOwner(this,id);},
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
