import {randomUUID} from 'node:crypto';
import {operationStage,operationAdvance} from './operation-progress.js';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {pageStylesheet} from './website-page-style.js';
import {researchId} from './web/research-reference.js';
import {attr,descendants} from './website-migration-views.js';
import {websiteInsertionOffset} from './website-file-html.js';
import {validateWebsiteHTML,websiteFileName} from './website-file-policy.js';
import {normalizeFeedCriteria,enumerateFeedMembers,feedMemberForSource,compareFeedMembers} from './website-feed-query.js';
import {changeGroups,initialGroups} from './website-feed-groups.js';
import {feedMarker,digest,maxPageBytes,feedCSS,feedStyle,feedSection,makeFeedRenderer,priorFeedRows,pageName,feedCardFields} from './website-feed-render.js';
import {continuationShell} from './website-feed-shell.js';
import {styledPageHTML} from './website-entry-styles.js';

const registry='.observanda/website-files/feed-sites',hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const scopeFile=id=>registry+'/'+id+'.json';
const bucket=criteria=>criteria.notebookId?'book-'+criteria.notebookId:criteria.projectId?'project-'+criteria.projectId:'all';
const buckets=site=>new Set((site?.feeds??[]).map(feed=>bucket(feed.criteria)));
const bucketDir=key=>registry+'/scopes/'+key;
function publicDefinition(feed){
 const {id,path,heading,criteria,layout,template,itemHTML,pageSize,cardFields}=feed;
 return {id,path,heading,criteria,layout,template,...(template==='custom'?{itemHTML}:{}),...(template==='card'&&cardFields?.length?{cardFields}:{}),pageSize,total:feed.members.length,pages:feed.groups.length,...(feed.unavailable?{unavailable:feed.unavailable}:{})};
}
function sitePage(manifest,path){
 websiteFileName(path);const page=manifest.pages.find(p=>p.path===path);if(!page)throw new AppError('NOT_FOUND');return page;
}
function selectedFeed(manifest,id,path){
 if(!researchId(id))throw new AppError('INVALID');const feed=manifest.feeds?.find(f=>f.id===id&&f.path===path);
 if(!feed)throw new AppError('NOT_FOUND');return feed;
}
function feedDefinition(options,id){
 const {path,heading,criteria={},template='full',layout='list',pageSize=12,itemHTML,cardFields=[]}=options;
 // A card shows its title and, chosen visually, the date, type and a short excerpt.
 if(!Array.isArray(cardFields)||cardFields.some(field=>!feedCardFields.includes(field))||new Set(cardFields).size!==cardFields.length||cardFields.length&&template!=='card')throw new AppError('INVALID');
 if(typeof heading!=='string'||!heading.trim()||heading.length>200||!['full','card','custom'].includes(template)||!['list','grid'].includes(layout)||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new AppError('INVALID');
 if(template!=='custom'&&itemHTML!==undefined&&itemHTML!==null&&itemHTML!=='')throw new AppError('INVALID');
 return {id,path,heading:heading.trim(),criteria:normalizeFeedCriteria(criteria),layout,template,...(template==='custom'?{itemHTML}:{}),...(cardFields.length?{cardFields:feedCardFields.filter(field=>cardFields.includes(field))}:{}),pageSize};
}
function hostSlot(html,id,existing,position){
 const doc=parse(html,{sourceCodeLocationInfo:true}),nodes=[...descendants(doc)];
 const slots=nodes.filter(n=>attr(n,feedMarker)===id);
 if(slots.length!==Number(existing)||slots[0]&&!slots[0].sourceCodeLocation?.endTag)throw new AppError('FORMAT');
 const loc=slots[0]?.sourceCodeLocation;
 if(loc)for(let parent=slots[0].parentNode;parent;parent=parent.parentNode){
  if(['nav','header','footer','template'].includes(parent.tagName)||parent.attrs?.some(a=>a.name===feedMarker||a.name.startsWith('data-observanda-')||a.name==='data-website-instance'||a.name==='hidden'))throw new AppError('CONFLICT');
 }
 const start=loc?.startOffset??0,end=loc?.endOffset??0,shell=html.slice(0,start)+html.slice(end);
 let at=position===undefined&&loc?start:websiteInsertionOffset(doc,position??'end');
 if(at>start&&at<end)throw new AppError('INVALID');if(at>=end)at-=end-start;
 const language=attr(nodes.find(n=>n.tagName==='html')??{},'lang')||'en';
 return {shell,at,language,old:html.slice(start,end),insert:block=>shell.slice(0,at)+block+shell.slice(at)};
}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function joinOwnedFile(files,descriptor){
 const former=files.get(descriptor.name);
 if(former&&!former.feedAsset||former&&former.sha256!==descriptor.sha256)throw new AppError('CONFLICT');
 if(!former||former.draft&&!descriptor.draft)files.set(descriptor.name,descriptor);
}
// Rebuild only the feed-owned public file membership from the sealed groups.
// Individual source blobs retain their own encrypted paths and content hashes.
export function retainWebsiteFeedAssets(manifest){
 const feeds=manifest.feeds??[];
 if(!feeds.length&&!manifest.files.some(f=>f.feedAsset))return manifest;
 const files=new Map(manifest.files.filter(f=>!f.feedAsset).map(f=>[f.name,f]));
 const pages=new Map(manifest.pages.map(p=>[p.path,p]));
 for(const feed of feeds){
  const page=pages.get(feed.path);if(!page)throw new AppError('FORMAT');
  for(const group of feed.groups)for(const asset of group.assets)joinOwnedFile(files,{...asset,...(page.draft?{draft:true}:{})});
 }
 return {...manifest,files:[...files.values()]};
}
export function websiteFeedPages(manifest){
 return (manifest.feeds??[]).flatMap(feed=>{
  const draft=manifest.pages.find(p=>p.path===feed.path)?.draft;
  return feed.groups.slice(1).map(group=>({path:pageName(feed,group.key),title:feed.heading,ownerPage:feed.path,...(draft?{draft:true}:{})}));
 });
}
export function validateFeedFiles(manifest,files){
 if(manifest.feeds===undefined)return;
 if(!Array.isArray(manifest.feeds))throw new AppError('FORMAT');
 const ids=new Set(),authored=new Set(manifest.pages.map(p=>p.path));
 for(const feed of manifest.feeds){
  if(!feed||!researchId(feed.id)||ids.has(feed.id)||!authored.has(feed.path)||!Array.isArray(feed.members)||!Array.isArray(feed.groups)||feed.groups[0]?.key!=='host')throw new AppError('FORMAT');
  ids.add(feed.id);const keys=new Set(),members=new Set();let index=0;
  for(const group of feed.groups){
   if(!group||keys.has(group.key)||group.key!=='host'&&(!researchId(group.key)||files.get(pageName(feed,group.key))?.feedPage!==feed.id)||!Array.isArray(group.ids)||!Array.isArray(group.assets)||!hex(group.stamp))throw new AppError('FORMAT');
   keys.add(group.key);
   for(const id of group.ids){
    const row=feed.members[index++];if(!hex(id)||members.has(id)||row?.id!==id||!hex(row.revision))throw new AppError('FORMAT');
    members.add(id);
   }
  }
  if(feed.unavailable==='capacity'){
   if(feed.groups.length!==1||index||feed.groups[0].assets.length)throw new AppError('FORMAT');
   for(const row of feed.members){if(!hex(row.id)||!hex(row.revision)||members.has(row.id))throw new AppError('FORMAT');members.add(row.id);}
  }else if(feed.unavailable||index!==feed.members.length)throw new AppError('FORMAT');
 }
}
export function websiteFeedOccurrences(manifest,sourceId){
 const items=[];
 for(const feed of manifest.feeds??[]){
  for(const group of feed.groups){
   const ordinal=group.ids.indexOf(sourceId);if(ordinal<0)continue;
   const owner=manifest.pages.find(p=>p.path===feed.path);if(!owner)throw new AppError('FORMAT');
   items.push({feedId:feed.id,path:pageName(feed,group.key),ownerPage:feed.path,pageTitle:group.key==='host'?owner.title:feed.heading,sectionTitle:feed.heading,
    anchor:'website-feed-'+feed.id,draft:Boolean(owner.draft),kind:'feed',editable:false,ordinal,blockPath:null});break;
  }
 }
 return items;
}
export async function writeFeedSubscription(store,manifest,prior,signal){
 if(!manifest.feeds?.length)return;
 const previous=buckets(prior);
 if(!prior?.feeds?.length)await store.writeControl(scopeFile(manifest.id),{id:manifest.id},{signal});
 for(const scope of buckets(manifest))if(!previous.has(scope)){
  await store.writeControl(bucketDir(scope)+'/'+manifest.id+'.json',{id:manifest.id},{signal});
 }
}
export async function clearFeedSubscription(store,manifest,prior){
 const next=buckets(manifest);
 for(const scope of buckets(prior))if(!next.has(scope))await store.remove(bucketDir(scope)+'/'+manifest.id+'.json');
 if(!manifest.feeds?.length&&prior?.feeds?.length)await store.remove(scopeFile(manifest.id));
}
async function* subscriptions(store,owners,signal){
 const dirs=new Set([bucketDir('all')]);
 for(const owner of owners){
  if(!owner){dirs.clear();dirs.add(registry);break;}
  for(const [type,id] of [['project',owner.projectId],['book',owner.notebookId]])if(id){
   if(!researchId(id))throw new AppError('FORMAT');dirs.add(bucketDir(type+'-'+id));
  }
 }
 const sites=new Map();
 for(const directory of dirs){
  await store.scope(scope=>scope.member(store.absolute(directory+'/sentinel'),async dir=>{
   if(!dir)return;
   for await(const member of dir.entries()){
    if(member.directory)continue;const name=member.name;
    signal?.throwIfAborted();const id=name.slice(0,-5);
    if(!researchId(id)||name!==id+'.json')throw new AppError('FORMAT');
    sites.set(id,directory+'/'+name);
   }
  },{missing:true}),{signal});
 }
 for(const [id,file] of sites){
  signal?.throwIfAborted();const row=await store.control(file);if(row.id!==id)throw new AppError('FORMAT');yield id;
 }
}
export async function hasFeedInterest(store,{projectId,notebookId}={}, {signal}={}){
 return store.scope(async()=>{
  const owner=notebookId?{projectId,notebookId}:null;
  for await(const id of subscriptions(store,[owner],signal)){
   const manifest=await store.raw(id,{missing:true});
   if(manifest?.feeds?.some(feed=>(!projectId||!feed.criteria.projectId||feed.criteria.projectId===projectId)&&(!notebookId||!feed.criteria.notebookId||feed.criteria.notebookId===notebookId)))return true;
  }
  return false;
 },{signal});
}
function reservePath(files,name,id){
 const previous=files.get(name);if(previous&&previous.feedPage!==id)throw new AppError('CONFLICT');
}
function stylesheet(store,manifest,files,feeds,signal){
 // Other feeds can still reference their previous layout until regenerated.
 // Reclaim a generated stylesheet once every remaining feed identifies its own.
 if(feeds.every(feed=>feed.layoutAsset)){
  const used=new Set(feeds.map(feed=>feed.layoutAsset));
  for(const [name,file] of files)if(file.feedStyle&&!used.has(name))files.delete(name);
 }
 const previous=files.get(feedStyle);if(previous&&!previous.feedStyle)throw new AppError('CONFLICT');files.delete(feedStyle);
 if(!feeds.length)return;
 const draft=feeds.every(feed=>manifest.pages.find(p=>p.path===feed.path).draft);
 if(previous&&Boolean(previous.draft)===draft){files.set(feedStyle,previous);return;}
 return store.siteFile(manifest.id,feedStyle,feedCSS,{draft,signal}).then(file=>files.set(feedStyle,{...file,feedStyle:true}));
}
async function materialize(store,manifest,old,feed,groups,position,signal,shared,renderer){
 const page=sitePage(manifest,feed?.path??old.path),files=new Map(manifest.files.map(f=>[f.name,f]));
 const id=feed?.id??old.id,original=await store.readText(files.get(page.path),{signal}),slot=hostSlot(original,id,Boolean(old),position);
 const compatible=old?.layoutAsset===feedStyle?old:null;
 const previous=new Map(compatible?.groups.map(g=>[g.key,g])??[]),rendered=[];
 const feedList=(manifest.feeds??[]).filter(f=>f.id!==id);
 let hostMarkup='';
 if(feed){
  const {render}=renderer??makeFeedRenderer(feed,Boolean(shared),manifest.id,Boolean(page.draft),shared);
  const byId=new Map(feed.members.map(m=>[m.id,m])),priorRow=priorFeedRows(store,manifest,compatible,feed,original,signal);
  const templatePin=digest(JSON.stringify([feed.heading,feed.template,feed.itemHTML,feed.layout,feed.path,slot.language,pageStylesheet(manifest,page),page.draft,feed.unavailable,...(feed.cardFields?.length?[feed.cardFields]:[])]));
  let shell;
  for(let i=0;i<groups.length;i++){
   signal?.throwIfAborted();
   const group=groups[i],file=pageName(feed,group.key),prev=groups[i-1]?.key??null,next=groups[i+1]?.key??null;
   const stamp=digest(JSON.stringify([templatePin,prev,next,group.ids.map(key=>byId.get(key)?.revision)])),prior=previous.get(group.key);
   if(prior?.stamp===stamp){
    if(i===0)hostMarkup=slot.old;rendered.push(prior);operationAdvance(group.ids.length,'feedRender');continue;
   }
   if(i>0)reservePath(files,file,id);
   const rows=[];let bytes=i===0?Buffer.byteLength(slot.shell):0;
   let split=null;
   for(const key of group.ids){
    const member=byId.get(key);if(!member)throw new AppError('FORMAT');
    const row=await priorRow(member,file)??await render(store,member,file,signal);bytes+=Buffer.byteLength(row.html);
    if(bytes>maxPageBytes){split=rows.length;break;}rows.push(row);
   }
   if(split!==null){
    if(split===0&&i!==0)throw new AppError('WEBSITE_FEED_CAPACITY');
    const overflow=group.ids.splice(split);groups.splice(i+1,0,{key:randomUUID(),ids:overflow});i--;continue;
   }
   let {markup,assets}=feedSection(feed,rows,file,prev,next,slot.language);
   if(feed.unavailable&&Buffer.byteLength(slot.insert(markup))>maxPageBytes)markup=markup.replace(/<h2>[^<]*<\/h2>/,'');
   if(i>0)shell??=continuationShell(slot.insert('<section '+feedMarker+'="'+feed.id+'"></section>'),feed,pageStylesheet(manifest,page));
   const html=styledPageHTML(i===0?slot.insert(markup):shell.render(markup),file).html;
   if(Buffer.byteLength(html)>maxPageBytes){
    if(!group.ids.length||i>0&&group.ids.length<2)throw new AppError('WEBSITE_FEED_CAPACITY');
    const count=group.ids.length===1?0:Math.ceil(group.ids.length/2);
    groups.splice(i+1,0,{key:randomUUID(),ids:group.ids.splice(count)});i--;continue;
   }
   if(i===0)hostMarkup=markup;
   else{
    validateWebsiteHTML(html,{file});files.set(file,{...await store.siteFile(manifest.id,file,html,{draft:page.draft,signal}),feedPage:id,feedShell:shell.stamp});
   }
   rendered.push({key:group.key,ids:group.ids,stamp,assets});
   operationAdvance(group.ids.length,'feedRender');
  }
  feedList.push({...feed,groups:rendered,layoutAsset:feedStyle});
 }
 const kept=new Set(rendered.map(g=>g.key));
 for(const g of old?.groups??[])if(g.key!=='host'&&!kept.has(g.key))files.delete(pageName(old,g.key));
 const html=slot.insert(hostMarkup);
 if(html!==original){
  validateWebsiteHTML(html,{file:page.path,scripts:await store.scripts(manifest.files)});
  files.set(page.path,await store.siteFile(manifest.id,page.path,html,{signal,draft:page.draft}));
 }
 await stylesheet(store,manifest,files,feedList,signal);
 return {...manifest,files:[...files.values()],feeds:feedList};
}
async function materializeUpdate(store,manifest,old,feed,groups,signal,shared){
 try{return await materialize(store,manifest,old,feed,groups,undefined,signal,shared);}
 catch(error){
  if(error.code!=='WEBSITE_FEED_CAPACITY')throw error;
  // Finish a legitimate grant even when the configured page cannot contain
  // one approved item. Keep the private rule editable and block publication.
  return materialize(store,manifest,old,{...feed,unavailable:'capacity'},[{key:'host',ids:[]}],undefined,signal,shared);
 }
}
export async function reflowFeedShell(store,manifest,feed,key,signal){
 const old={...feed,groups:feed.groups.map(g=>g.key===key?{...g,stamp:null}:g)};
 const next={...feed};delete next.shellHost;
 const groups=feed.groups.map(g=>({key:g.key,ids:[...g.ids]}));
 return materializeUpdate(store,manifest,old,next,groups,signal,{});
}
// The owning page already contains the new, empty slot. Build its first
// materialization from the saved membership through the usual grant checks.
export function duplicateWebsiteFeed(store,manifest,original,id,path,keys,signal){
 const {shellHost,layoutAsset,groups,...definition}=original;
 const slots=groups.map(group=>({key:group.key==='host'?'host':keys.get(group.key),ids:[...group.ids]}));
 const feed={...definition,id,path};
 return materializeUpdate(store,manifest,{id,path,groups:[]},feed,slots,signal,{});
}
function requireExpected(revision){if(!hex(revision))throw new AppError('INVALID');}
export function readWebsiteFeed(store,siteId,{expectedRevision,path,feedId,signal}){
 if(!researchId(siteId))throw new AppError('INVALID');
 requireExpected(expectedRevision);
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision);sitePage(manifest,path);
  if(feedId!=null)return {feed:publicDefinition(selectedFeed(manifest,feedId,path)),revision:manifest.revision};
  return {feeds:(manifest.feeds??[]).filter(feed=>feed.path===path).map(publicDefinition),revision:manifest.revision};
 },{signal});
}
export function saveWebsiteFeed(store,siteId,options){
 if(!researchId(siteId))throw new AppError('INVALID');
 const {expectedRevision,path,feedId,position,signal}=options;requireExpected(expectedRevision);
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision),page=sitePage(manifest,path);
  const old=feedId==null?null:selectedFeed(manifest,feedId,path),feed=feedDefinition(options,old?.id??randomUUID());
  const renderer=makeFeedRenderer(feed,false,siteId,Boolean(page.draft));
  const members=await operationStage('feedScan',{unit:'records'},()=>enumerateFeedMembers(store,feed.criteria,{signal,admittedRows:renderer.admittedRows}));
  const groups=initialGroups(members,feed.pageSize,old?.groups);
  const next=await operationStage('feedRender',{unit:'records',total:members.length},()=>materialize(store,manifest,old,{...feed,members},groups,position,signal,undefined,renderer));
  return operationStage('feedCommit',{unit:'items',total:1},async()=>{
   const saved=await store.present(await store.commit(next,{signal}),path,{signal});operationAdvance();return {...saved,feedId:feed.id};
  });
 },{write:true,signal});
}
export function removeWebsiteFeed(store,siteId,{expectedRevision,path,feedId,signal}){
 if(!researchId(siteId))throw new AppError('INVALID');
 requireExpected(expectedRevision);
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision),old=selectedFeed(manifest,feedId,path);
  const next=await materialize(store,manifest,old,null,[],undefined,signal);
  return store.present(await store.commit(next,{signal}),path,{signal});
 },{write:true,signal});
}
// Called under the file writer and the publication/owner fence. Apply all
// tombstones for an owner in one site revision before that fence is released.
export async function refreshFeedBatch(store,sources,{signal}={}){
 const updates=new Map(sources.filter(s=>s.target==='website').map(s=>[s.id,s]));if(!updates.size)return;
 const shared={};
 for await(const id of subscriptions(store,[...updates.values()].map(s=>s.provenance),signal)){
  let manifest=await store.raw(id,{missing:true});if(!manifest?.feeds?.length)continue;
  let changed=false;
  for(const feed of [...manifest.feeds]){
   const prior=new Map(feed.members.map(m=>[m.id,m])),revised=new Map();
   for(const source of updates.values()){
    const member=await feedMemberForSource(store,feed.criteria,source,{signal});
    if(!same(prior.get(source.id)??null,member??null))revised.set(source.id,member);
   }
   if(!revised.size)continue;
   const compare=(a,b)=>compareFeedMembers(a,b,feed.criteria);
   let members,groups;
   if(revised.size===1){
    const [key,member]=revised.entries().next().value;({members,groups}=changeGroups(feed,key,member,compare));
   }else{
    members=feed.members.filter(m=>!revised.has(m.id));
    const admitted=[...revised.values()].filter(Boolean);
    if(admitted.length){for(const row of admitted)members.push(row);members.sort(compare);groups=initialGroups(members,feed.pageSize,feed.groups);}
    else{
     groups=feed.groups.map(g=>({key:g.key,ids:g.ids.filter(key=>!revised.has(key))})).filter(g=>g.key==='host'||g.ids.length);
     if(!groups[0].ids.length&&groups.length>1)groups[0].ids=groups.splice(1,1)[0].ids;
    }
   }
   const next={...feed,members};delete next.unavailable;
   if(feed.unavailable)groups=initialGroups(members,feed.pageSize);
   manifest=await materializeUpdate(store,manifest,feed,next,groups,signal,shared);
   changed=true;
  }
  if(changed)await store.commit(manifest,{signal});
 }
}
export function refreshFeedSubscriptions(store,source,options){return refreshFeedBatch(store,[source],options);}
