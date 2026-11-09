import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {WebsiteFileContent} from './website-file-store.js';
import {governedResources} from './website-version-snapshots.js';
import {omitPrivateStyleURLs} from './website-page-dependencies.js';
import {componentContext} from './website-component-storage.js';
import {copiedComponentHTML,copiedPageOwner,duplicateSitePage,duplicatedFeedIds} from './website-page-duplicate.js';
import {movedWebsiteText} from './website-page-paths.js';
import {duplicateWebsiteFeed} from './website-dynamic-feeds.js';

const idsFor=rows=>new Map((rows??[]).map(row=>[row.id,randomUUID()]));
const assignments=(table,ids)=>Object.fromEntries(Object.entries(table).map(([name,id])=>[name,ids.get(id)]));
const derived=file=>file.themeSheet||file.appearanceSheet||file.tokenSheet||file.entryDisplaySheet||file.feedStyle;
const invalid=()=>{throw new AppError('INVALID');};

async function duplicateSite(store,source,options){
 const {copyId:id,title,includeEntries,signal,reviewId}=options;
 const previous=await store.raw(id,{missing:true});
 if(previous){
  if(previous.copyReceipt!==reviewId||previous.archived)throw new AppError('CONFLICT');
  return store.present(await store.current(id),'index.html',{signal});
 }
 const feedCopies=duplicatedFeedIds(includeEntries?source.feeds:[]);
 const ids={components:idsFor(source.components),themes:idsFor(source.themeBook?.items),tokens:idsFor(source.styleBook?.tokens),menus:new Map(),feeds:feedCopies.ids,feedPaths:feedCopies.paths,pageAnchors:new Map()};
 const assets=new Map(),original=new Map(source.files.map(file=>[file.name,file])),governed=governedResources(source);
 const candidate={id,name:title,cssPath:source.cssPath,pages:[],sources:[],files:[],copyReceipt:reviewId};
 if(source.pictureStyles)candidate.pictureStyles=structuredClone(source.pictureStyles);
 if(source.appearance)candidate.appearance=structuredClone(source.appearance);
 if(source.themeBook){
  const book=source.themeBook;
  candidate.themeBook={items:book.items.map(item=>({...item,id:ids.themes.get(item.id)})),pages:assignments(book.pages,ids.themes),folders:assignments(book.folders,ids.themes)};
 }
 if(source.pageDesigns)candidate.pageDesigns=source.pageDesigns.map(d=>({...d,id:randomUUID()}));
 if(source.styleBook){
  const book=source.styleBook,remap=values=>values.map(id=>ids.tokens.get(id));
  const scopes=table=>Object.fromEntries(Object.entries(table).map(([name,list])=>[name,remap(list)]));
  candidate.styleBook={tokens:book.tokens.map(t=>({...t,id:ids.tokens.get(t.id)})),fonts:structuredClone(book.fonts),site:remap(book.site),folders:scopes(book.folders),pages:scopes(book.pages)};
 }
 const staged=new Set();
 try{
  for(const file of source.files){
   signal?.throwIfAborted();
   if(file.name.endsWith('.html')||file.sourceId||file.feedAsset||derived(file))continue;
   let value={content:new WebsiteFileContent(store,source.id,source.revision,file),contentType:file.contentType};
   if(!includeEntries&&file.name.endsWith('.css')&&governed.size&&(!file.references||file.references.some(r=>governed.has(r.name.toLowerCase())))){
    value=omitPrivateStyleURLs(await store.readText(file,{signal}),file.name,governed);
   }
   if(includeEntries&&file.name.endsWith('.css')&&ids.feedPaths.size&&(!file.references||file.references.some(r=>ids.feedPaths.has(r.name.toLowerCase())))){
    value=movedWebsiteText(await store.readText(file,{signal}),file.name,file.name,ids.feedPaths);
   }
   const owned=await store.siteFile(id,file.name,value,{draft:file.draft,signal});staged.add(owned.blob);
   assets.set(file.name,{...file,...owned});
  }
  if(source.components)candidate.components=source.components.map(main=>({...main,id:ids.components.get(main.id),html:copiedComponentHTML(main.html,ids),pictures:main.pictures.map(f=>assets.get(f.name)),...(main.recordings?{recordings:main.recordings.map(f=>assets.get(f.name))}:{})}));
  const scripts=await store.scripts(source.files);
  const context=componentContext({...candidate,pages:source.pages,files:[...assets.values()]});
  for(const p of source.pages)context.files.set(p.path,{name:p.path,draft:p.draft});
  const copies=new Map();
  for(const owner of source.pages){
   const {page,anchors}=copiedPageOwner(owner,includeEntries,ids.components);copies.set(owner.path,page);ids.pageAnchors.set(owner.path,anchors);
  }
  for(const feed of source.feeds??[])if(ids.feeds.has(feed.id))ids.pageAnchors.get(feed.path).set(feed.id,ids.feeds.get(feed.id));
  for(const owner of source.pages){
   signal?.throwIfAborted();
   const text=await store.readText(original.get(owner.path),{signal});
   const {page,html}=duplicateSitePage(text,owner,copies.get(owner.path),context,ids,governed,includeEntries,scripts);
   const file=await store.siteFile(id,page.path,html,{draft:page.draft,signal});staged.add(file.blob);
   assets.set(file.name,file);candidate.pages.push(page);
  }
  candidate.sources=[...new Map(candidate.pages.flatMap(p=>p.placements.map(({id,revision})=>[id,{id,revision}]))).values()];
  candidate.files=await store.siteAssets([...assets.values()],candidate.sources,candidate.pages);
  let complete=candidate;
  if(includeEntries)for(const feed of source.feeds??[])complete=await duplicateWebsiteFeed(store,complete,feed,ids.feeds.get(feed.id),feed.path,feedCopies.groups.get(feed.id),signal);
  await store.assertSources(complete);
  return await store.present(await store.commit(complete,{signal}),'index.html',{signal});
 }catch(error){
  if(!await store.raw(id,{missing:true}))for(const blob of staged)await store.discardStaged(blob);
  throw error;
 }
}

export function websiteSiteLifecycle(store,siteId,options,apply=false){
 const {action,expectedRevision,title,copyId,includeEntries=false,offset=0,signal}=options;
 if(!['rename','duplicate','archive','restore'].includes(action)||!/^[a-f0-9]{64}$/.test(expectedRevision??'')||!Number.isSafeInteger(offset)||offset<0||typeof includeEntries!=='boolean')invalid();
 if(['rename','duplicate'].includes(action)&&(typeof title!=='string'||!title.trim()||title.length>200))invalid();
 if(action==='duplicate'&&(!researchId(copyId)||siteId===copyId))invalid();
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision,{archived:action==='restore'});
  if(Boolean(manifest.archived)!==(action==='restore'))throw new AppError('NOT_FOUND');
  const pin=digest(JSON.stringify([store.workspace.vault.id,siteId,expectedRevision,action,title,copyId,includeEntries]));
  if(!apply){
   const rows=manifest.pages.slice(offset,offset+40).map(p=>({name:p.path,title:p.title,kind:p.archived?'archivedPage':p.draft?'privatePage':'page',count:1}));
   return {revision:expectedRevision,reviewId:pin,action,items:rows,total:manifest.pages.length,next:offset+40<manifest.pages.length?offset+40:null,counts:{components:manifest.components?.length??0,feeds:manifest.feeds?.length??0,sources:manifest.sources.length,designs:manifest.pageDesigns?.length??0,themes:manifest.themeBook?.items.length??0}};
  }
  if(pin!==options.reviewId)throw new AppError('CONFLICT');
  if(action==='duplicate')return duplicateSite(store,manifest,{...options,title:title.trim(),includeEntries});
  const next={...manifest};
  if(action==='rename')next.name=title.trim();
  else if(action==='archive')next.archived=true;
  else delete next.archived;
  await store.assertSources(next);const saved=await store.commit(next,{signal});
  return action==='archive'?{siteId,revision:saved.revision,archived:true}:store.present(saved,'index.html',{signal});
 },{write:apply,signal});
}
