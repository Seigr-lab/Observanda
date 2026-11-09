import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {websiteFileName} from './website-file-policy.js';
import {fileReferences,publicText,websiteFileReferences} from './website-page-dependencies.js';
import {addPageStyle,newPageStylesheet,pageStylesheet,sharedDraftStyle,switchBaseStyle} from './website-page-style.js';
import {componentUseCounts} from './website-component-schema.js';

const pageSize=40;
// One open review per unlocked workspace. Retain only its impact rows and
// membership sets. Source documents and media bytes stay in their owners.
const openReviews=new WeakMap();
const managedAsset=file=>Boolean(file.sourceId||file.feedAsset||file.themeSheet||file.appearanceSheet||file.entryDisplaySheet||file.componentSheet);
const byName=files=>new Map(files.map(f=>[f.name,f]));
const mediaOf=component=>[...component.pictures,...(component.recordings??[])];
function dependencies(roots,refs,files){
 const seen=new Set(),pending=[...roots];
 while(pending.length){
  const name=pending.pop();if(seen.has(name))continue;seen.add(name);
  for(const ref of refs.get(name)??[]){
   // A normal link to a page never publishes that other page's resources.
   if(!ref.name.endsWith('.html')&&files.has(ref.name)&&!seen.has(ref.name))pending.push(ref.name);
  }
 }
 return seen;
}
async function inclusionPlan(store,manifest,page,included,signal){
 const files=byName(manifest.files),names=new Map([...files.keys()].map(name=>[name.toLowerCase(),name])),refs=new Map(),rows=[];
 for(const file of files.values()){
  signal?.throwIfAborted();
  if(/\.(?:html|css)$/.test(file.name)){
   const values=await fileReferences(store,file,signal);
   refs.set(file.name,values.map(ref=>({...ref,name:names.get(ref.name.toLowerCase())??ref.name})));
  }
 }
 const feeds=manifest.feeds??[],ownFeeds=feeds.filter(f=>f.path===page.path),feedIds=new Set(ownFeeds.map(f=>f.id));
 const ownPages=new Set([page.path,...manifest.files.filter(f=>feedIds.has(f.feedPage)).map(f=>f.name)]);
 const otherPublicPages=manifest.pages.filter(p=>p.path!==page.path&&!p.draft);
 const otherPrivateSheets=new Set(manifest.pages.filter(p=>p.path!==page.path&&p.draft&&p.stylePath).map(p=>p.stylePath));
 const sharedDraft=manifest.pages.some(p=>p.path!==page.path&&p.draft&&(!p.stylePath||p.sharedDraftBase));
 if(sharedDraft)otherPrivateSheets.add(sharedDraftStyle);
 const privateTargets=new Set([...files.values()].filter(f=>f.draft&&f.name.endsWith('.html')&&!ownPages.has(f.name)).map(f=>f.name.toLowerCase()));
 for(const name of otherPrivateSheets)privateTargets.add(name.toLowerCase());
 const visibleReferences=async(blocked,base)=>{
  const result=new Map(base);
  for(const [name,values] of base){
   if(otherPrivateSheets.has(name)){result.set(name,[]);continue;}
   if(!values.some(ref=>blocked.has(ref.name.toLowerCase())))continue;
   const text=await store.readText(files.get(name),{signal});
   const filtered=websiteFileReferences(publicText(text,name,blocked),name);
   result.set(name,filtered.map(ref=>({...ref,name:names.get(ref.name.toLowerCase())??ref.name})));
  }
  return result;
 };
 const eligible=await visibleReferences(privateTargets,refs);
 const publicAfter=new Set([...privateTargets,...[...ownPages].map(name=>name.toLowerCase())]);
 const otherRoots=[manifest.cssPath,...otherPublicPages.map(p=>p.path),...otherPublicPages.map(p=>pageStylesheet(manifest,p)),...manifest.files.filter(f=>f.feedPage&&!f.draft&&!ownPages.has(f.name)).map(f=>f.name)];
 const otherAssets=dependencies(otherRoots,included?eligible:await visibleReferences(publicAfter,eligible),files);
 const affected=dependencies([...ownPages,pageStylesheet(manifest,page)],eligible,files);
 const components=new Map((manifest.components??[]).map(c=>[c.id,c]));
 const ownComponents=componentUseCounts(components,page.instances??[]);
 const otherUses=componentUseCounts(components,otherPublicPages.flatMap(p=>p.instances??[]));
 for(const c of components.values()){
  if(ownComponents.has(c.id)){
   rows.push({kind:'component',name:c.name,count:ownComponents.get(c.id),shared:otherUses.has(c.id)});
   for(const f of mediaOf(c))affected.add(f.name);
  }
  if(otherUses.has(c.id)||!c.draft&&!c.inclusionOwned)for(const f of mediaOf(c))otherAssets.add(f.name);
 }
 for(const feed of ownFeeds)rows.push({kind:'feed',name:feed.heading,count:feed.members.length});
 for(const name of ownPages)rows.push({kind:name===page.path?'page':'continuation',name});
 for(const [source,references] of refs){
  if(ownPages.has(source))continue;
  for(const ref of references)if(ownPages.has(ref.name))rows.push({kind:ref.kind==='menu'?'menu':'link',name:source,target:ref.name,count:ref.count,shared:!files.get(source).draft});
 }
 const change=new Set();
 if(page.draft&&!page.stylePath)affected.add(sharedDraftStyle);
 for(const name of affected){
  const file=files.get(name);
  if(!file||ownPages.has(name)||name===manifest.cssPath)continue;
  if(name===sharedDraftStyle){rows.push({kind:sharedDraft?'sharedStyle':'draftStyle',name});continue;}
  if(otherPrivateSheets.has(name)){rows.push({kind:'sharedStyle',name});continue;}
  // Generated and permission-owned descriptors are reclassified by the
  // authoritative source/feed/theme synchronizers inside the same commit.
  const shared=otherAssets.has(name);
  rows.push({kind:'asset',name,shared,bytes:file.size});
  if((included||!shared||name===page.stylePath)&&!managedAsset(file)&&Boolean(file.draft)===included)change.add(name);
 }
 rows.sort((a,b)=>a.kind.localeCompare(b.kind,'en')||a.name.localeCompare(b.name,'en')||(a.target??'').localeCompare(b.target??'','en'));
 const counts={};for(const row of rows)counts[row.kind]=(counts[row.kind]??0)+1;
 const pin=digest(JSON.stringify([manifest.id,manifest.revision,page.path,included,rows]));
 return {rows,counts,pin,ownPages,change,ownComponents,otherUses,sharedDraft};
}
function visibility(row,draft){
 const next={...row};
 if(draft)next.draft=true;else delete next.draft;
 return next;
}
export function pageInclusion(store,siteId,{expectedRevision,path,inclusion,reviewId,offset=0,signal},apply=false,archive=false){
 if(!/^[a-f0-9]{64}$/.test(expectedRevision??'')||!['private','included'].includes(inclusion)||!Number.isSafeInteger(offset)||offset<0)throw new AppError('INVALID');
 websiteFileName(path);
 return store.scope(async()=>{
  const {vault,root}=store.workspace,key=JSON.stringify([root,siteId,expectedRevision,path,inclusion]);
  const stored=openReviews.get(vault),cached=stored?.key===key?stored.plan:null;
  const present=plan=>({revision:expectedRevision,reviewId:plan.pin,path,inclusion,total:plan.rows.length,counts:{...plan.counts},items:plan.rows.slice(offset,offset+pageSize).map(row=>({...row})),previous:Math.max(0,offset-pageSize),next:offset+pageSize<plan.rows.length?offset+pageSize:null});
  if(cached&&!apply){
   const head=await store.versionStatus(siteId,{expectedRevision,signal});
   if(head.revision!==expectedRevision)throw new AppError('CONFLICT');
   return present(cached);
  }
  const manifest=await store.current(siteId,expectedRevision),page=manifest.pages.find(p=>p.path===path);
  if(!page||page.archived)throw new AppError('NOT_FOUND');
  const included=inclusion==='included',draft=!included;
  if(path==='index.html'&&draft)throw new AppError('WEBSITE_HOME_REQUIRED');
  if(Boolean(page.draft)===draft)throw new AppError('CONFLICT');
  const plan=cached??await inclusionPlan(store,manifest,page,included,signal);
  if(!apply){
   openReviews.set(vault,{key,plan});
   return present(plan);
  }
  if(plan.pin!==reviewId)throw new AppError('CONFLICT');
  const files=byName(manifest.files),nextPage=visibility(page,draft),previous=new Set(manifest.files.map(f=>f.blob)),added=new Set();
  if(archive){if(!draft)throw new AppError('INVALID');nextPage.archived=true;}
  const keep=file=>{files.set(file.name,file);if(!previous.has(file.blob))added.add(file.blob);};
  try{
   for(const name of plan.change)keep(await store.ownFile(siteId,files.get(name),draft,signal));
   const components=(manifest.components??[]).map(main=>{
    let next={...main};
    if(plan.ownComponents.has(main.id)&&!plan.otherUses.has(main.id)&&(main.draft||main.inclusionOwned))next={...visibility(next,draft),inclusionOwned:true};
    next.pictures=main.pictures.map(a=>files.get(a.name));
    if(main.recordings)next.recordings=main.recordings.map(a=>files.get(a.name));
    return next;
   });
   let html=await store.readText(files.get(path),{signal});
   let pictureStyles=manifest.pictureStyles;
   if(!page.stylePath){
    nextPage.stylePath=newPageStylesheet(manifest);
    const source=files.get(sharedDraftStyle),copy=page.draft&&source&&!plan.sharedDraft;
    const css=copy?await store.readText(source,{signal}):'';
    keep(await store.siteFile(siteId,nextPage.stylePath,css,{draft,signal}));
    if(copy)pictureStyles={...pictureStyles,[nextPage.stylePath]:pictureStyles?.[sharedDraftStyle]??[]};
    if(page.draft){
     html=switchBaseStyle(html,path,sharedDraftStyle,manifest.cssPath);
     if(plan.sharedDraft)nextPage.sharedDraftBase=true;
    }
    html=addPageStyle(html,path,nextPage.stylePath);
   }else if(page.sharedDraftBase){
    html=switchBaseStyle(html,path,draft?manifest.cssPath:sharedDraftStyle,draft?sharedDraftStyle:manifest.cssPath);
   }
   keep({...await store.siteFile(siteId,path,html,{draft,signal})});
   for(const name of plan.ownPages)if(name!==path)keep(await store.ownFile(siteId,files.get(name),draft,signal));
   const pages=manifest.pages.map(p=>p===page?nextPage:p),candidate={...manifest,pages,files:await store.siteAssets([...files.values()],manifest.sources,pages)};
   if(components.length)candidate.components=components;
   if(pictureStyles)candidate.pictureStyles=pictureStyles;
   await store.assertSources(candidate);
   const saved=await store.commit(candidate,{signal});
   if(openReviews.get(vault)?.key===key)openReviews.delete(vault);
   return store.present(saved,archive?'index.html':path,{signal});
  }catch(error){
   if((await store.raw(siteId)).revision===expectedRevision)for(const blob of added)await store.discardStaged(blob);
   throw error;
  }
 },{write:apply,signal});
}
