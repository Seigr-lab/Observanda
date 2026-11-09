import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {websiteFileName,websiteLocalURL,validateWebsiteCSS,validateWebsiteHTML} from './website-file-policy.js';
import {fileReferences,websiteFileReferences} from './website-page-dependencies.js';
import {assertPageDestination,movedWebsiteText,movedWebsiteURL,namedWebsitePage} from './website-page-paths.js';
import {websiteSourcePlacements} from './website-file-html.js';
import {hasWebsitePageRecovery} from './website-recovery.js';
import {pageInclusion} from './website-page-inclusion.js';
import {duplicateWebsitePage} from './website-page-duplicate.js';

const openReviews=new WeakMap();
const fold=name=>name.normalize('NFC').toLowerCase();
const fail=code=>{throw new AppError(code);};
const changeAddress=(name,path,destination)=>name===path?destination:name;
const isText=name=>/\.(?:html|css)$/.test(name);
const pageSize=40;

export function archivedWebsitePages(store,siteId,{expectedRevision,offset=0,query='',signal}){
 if(!/^[a-f0-9]{64}$/.test(expectedRevision??'')||!Number.isSafeInteger(offset)||offset<0||typeof query!=='string'||query.length>200)fail('INVALID');
 return store.scope(async()=>{
  const site=await store.current(siteId,expectedRevision),search=fold(query.trim()),items=[];
  let total=0;
  for(const page of site.pages){
   if(!page.archived||search&&!fold(page.title+' '+page.path).includes(search))continue;
   if(total>=offset&&items.length<pageSize)items.push({title:page.title,path:page.path});
   total++;
  }
  return {items,total,next:offset+pageSize<total?offset+pageSize:null,revision:site.revision};
 },{signal});
}

function reviewRows(manifest,page,action){
 const rows=[{kind:'page',name:page.path,count:1}];
 for(const [kind,count] of [['source',page.placements.length],['instance',page.instances?.length],['gallery',page.sourceGalleries?.length]]){
  if(count)rows.push({kind,name:page.path,count});
 }
 for(const feed of manifest.feeds??[])if(feed.path===page.path)rows.push({kind:'feed',name:feed.heading,count:feed.groups.length});
 if(manifest.themeBook?.pages[page.path])rows.push({kind:'theme',name:page.path,count:1});
 for(const design of manifest.pageDesigns??[])if(design.source===page.path)rows.push({kind:'design',name:design.name,count:1});
 if(!page.draft&&action!=='rename')rows.push({kind:'publication',name:page.path,count:1});
 return rows;
}
async function planPage(store,manifest,page,action,signal){
 const rows=reviewRows(manifest,page,action),files=new Set([page.path]),masters=new Set();
 if(action!=='rename'){
  const target=fold(page.path);
  for(const file of manifest.files){
   signal?.throwIfAborted();
   if(!isText(file.name))continue;
   for(const ref of await fileReferences(store,file,signal)){
    if(fold(ref.name)!==target)continue;
    rows.push({kind:ref.kind,name:file.name,count:ref.count});files.add(file.name);
   }
  }
  for(const main of manifest.components??[]){
   const hits=websiteFileReferences(main.html,'index.html').filter(ref=>fold(ref.name)===target);
   if(hits.length){rows.push({kind:'component',name:main.name,count:hits.reduce((sum,r)=>sum+r.count,0)});masters.add(main.id);}
  }
  for(const p of manifest.pages){
   const blocked=p.placements.filter(r=>r.link&&websiteLocalURL(r.href,p.path)?.toLowerCase()===target);
   if(blocked.length)rows.push({kind:'sourceLink',name:p.path,count:blocked.length});
  }
 }
 return {rows,files,masters,private:!!page.draft};
}
async function moveOrRename(store,manifest,owner,plan,{action,destination,title,signal}){
 const path=owner.path,move=action==='move',target=move?destination:path;
 const files=new Map(manifest.files.map(f=>[f.name,f])),pages=new Map(manifest.pages.map(p=>[p.path,p]));
 const scripts=await store.scripts(manifest.files);
 for(const name of plan.files){
  signal?.throwIfAborted();
  const file=files.get(name),nextName=changeAddress(name,path,target);
  if(file.sourceId||file.feedAsset)fail('CONFLICT');
  const html=await store.readText(file,{signal});
  const edited=move?movedWebsiteText(html,name,nextName,path,target):namedWebsitePage(html,title);
  const page=pages.get(name);
  if(page){
   const placements=move?page.placements.map(r=>r.link?{...r,href:movedWebsiteURL(r.href,name,nextName,path,target)}:r):page.placements;
   pages.delete(name);pages.set(nextName,{...page,path:nextName,...(!move?{title}:{}),placements:websiteSourcePlacements(edited,placements)});
  }
  if(edited===html&&name===nextName)continue;
  if(nextName.endsWith('.css'))validateWebsiteCSS(edited,{file:nextName});
  else validateWebsiteHTML(edited,{file:nextName,scripts});
  files.delete(name);files.set(nextName,{...file,...await store.siteFile(manifest.id,nextName,edited,{draft:file.draft,signal})});
 }
 if(move){
  // A withdrawn navigation label has no href in its rendered anchor. Its
  // encrypted placement still owns the address needed on later regrant.
  for(const [name,page] of pages)if(!plan.files.has(name)&&name!==target&&page.placements.some(r=>r.link)){
   const placements=page.placements.map(r=>r.link?{...r,href:movedWebsiteURL(r.href,name,name,path,target)}:r);
   pages.set(name,{...page,placements});
  }
 }
 const candidate={...manifest,files:[...files.values()],pages:manifest.pages.map(p=>pages.get(changeAddress(p.path,path,target)))};
 if(move){
  if(manifest.components)candidate.components=manifest.components.map(main=>plan.masters.has(main.id)?{...main,html:movedWebsiteText(main.html,'index.html','index.html',path,target)}:main);
  if(manifest.pageDesigns)candidate.pageDesigns=manifest.pageDesigns.map(d=>d.source===path?{...d,source:target}:d);
  if(manifest.feeds)candidate.feeds=manifest.feeds.map(f=>f.path===path?{...f,path:target,shellHost:null}:f);
  if(manifest.themeBook?.pages[path]){
   const assignments={...manifest.themeBook.pages,[target]:manifest.themeBook.pages[path]};delete assignments[path];
   candidate.themeBook={...manifest.themeBook,pages:assignments};
  }
  if(manifest.editHistory?.page===path)candidate.editHistory={...manifest.editHistory,page:target};
 }
 if(!move){
  candidate.sources=[...new Map(candidate.pages.flatMap(page=>page.placements.map(({id,revision})=>[id,{id,revision}]))).values()];
  candidate.files=await store.siteAssets(candidate.files,candidate.sources,candidate.pages);
 }
 await store.assertSources(candidate);
 return store.present(await store.commit(candidate,{signal}),target,{signal});
}

export function websitePageLifecycle(store,siteId,options,apply=false){
 const {action,path,destination,title,includeEntries=false,expectedRevision,offset=0,reviewId,signal}=options;
 if(!['rename','move','duplicate','archive','restore'].includes(action)||!/^[a-f0-9]{64}$/.test(expectedRevision??'')||!Number.isSafeInteger(offset)||offset<0||typeof includeEntries!=='boolean')fail('INVALID');
 if(['rename','duplicate'].includes(action)&&(typeof title!=='string'||!title.trim()||title.length>200))fail('INVALID');
 websiteFileName(path);
 return store.scope(async()=>{
  const key=digest(JSON.stringify([store.workspace.root,siteId,expectedRevision,action,path,destination,title,includeEntries])),prior=openReviews.get(store.workspace.vault);
  let plan=prior?.key===key?prior.plan:null,manifest,page;
  if(!plan||apply){
   manifest=await store.current(siteId,expectedRevision);page=manifest.pages.find(p=>p.path===path);
   if(!page||Boolean(page.archived)!==(action==='restore'))fail('NOT_FOUND');
   if(['archive','move'].includes(action)&&path==='index.html')fail('WEBSITE_HOME_REQUIRED');
   if(['move','duplicate'].includes(action))assertPageDestination(manifest,destination);
   if(!plan){plan=await planPage(store,manifest,page,action,signal);openReviews.set(store.workspace.vault,{key,plan});}
  }else if((await store.versionStatus(siteId,{expectedRevision,signal})).revision!==expectedRevision)fail('CONFLICT');
  const recovery=['move','archive'].includes(action)&&await hasWebsitePageRecovery(store,siteId,path,signal);
  const inclusion=action==='archive'&&!plan.private?await pageInclusion(store,siteId,{expectedRevision,path,inclusion:'private',signal}):null;
  const pin=digest(JSON.stringify([key,recovery,inclusion?.reviewId]));
  if(!apply)return {revision:expectedRevision,reviewId:pin,action,path,destination,total:plan.rows.length,items:plan.rows.slice(offset,offset+pageSize),next:offset+pageSize<plan.rows.length?offset+pageSize:null,blocked:recovery?'recovery':null,...(inclusion?{inclusion:inclusion.counts}:{})};
  if(pin!==reviewId||recovery)fail('CONFLICT');
  if(action==='duplicate')return duplicateWebsitePage(store,manifest,page,{destination,title:title.trim(),includeEntries,signal});
  if(action==='archive'&&inclusion)return pageInclusion(store,siteId,{expectedRevision,path,inclusion:'private',reviewId:inclusion.reviewId,signal},true,true);
  if(action==='archive'||action==='restore'){
   const owner={...page};if(action==='archive')owner.archived=true;else delete owner.archived;
   const candidate={...manifest,pages:manifest.pages.map(p=>p===page?owner:p)};
   await store.assertSources(candidate);
   return store.present(await store.commit(candidate,{signal}),action==='archive'?'index.html':path,{signal});
  }
  return moveOrRename(store,manifest,page,plan,{action,destination,title:title?.trim(),signal});
 },{write:apply,signal});
}
