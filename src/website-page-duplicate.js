import {randomUUID} from 'node:crypto';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {websiteDocumentTitle,websiteSourcePlacements,escapeWebsiteText} from './website-file-html.js';
import {validateWebsiteHTML,validateWebsiteCSS,websiteLocalURL} from './website-file-policy.js';
import {movedWebsiteText,movedWebsiteURL,namedWebsitePage} from './website-page-paths.js';
import {addPageStyle,newPageStylesheet,switchBaseStyle} from './website-page-style.js';
import {governedResources} from './website-version-snapshots.js';
import {authoredPageVersion} from './website-version-document.js';
import {omitPrivateStyleURLs} from './website-page-dependencies.js';
import {componentContext} from './website-component-storage.js';
import {renderComponentInstance} from './website-file-component.js';
import {duplicateWebsiteFeed} from './website-dynamic-feeds.js';

const attributes=node=>new Map(node.attrs?.map(a=>[a.name,a.value]));
const generatedId=/((?:wc|entry|feed|website-feed)-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
const generatedReference=new Set(['id','href','for','headers','aria-labelledby','aria-describedby']);
const managedIdentity=new Set(['data-website-source-gallery','data-website-source-slot','data-observanda-display-id']);
export function duplicatedFeedIds(feeds){
 const ids=new Map(),groups=new Map(),paths=new Map();
 for(const feed of feeds??[]){
  const id=randomUUID(),keys=new Map();ids.set(feed.id,id);groups.set(feed.id,keys);
  for(const g of feed.groups.slice(1)){
   const key=randomUUID();keys.set(g.key,key);
   paths.set('feeds/'+feed.id+'/'+g.key+'.html','feeds/'+id+'/'+key+'.html');
  }
 }
 return {ids,groups,paths};
}

// Make independent page-local identities. Source owner IDs and their
// permission revisions remain the responsibility of the source publisher.
function independentHTML(html,page,former,model,feeds,siteIds){
 const instanceById=new Map((former.instances??[]).map((row,i)=>[row.id,page.instances[i]]));
 const ids=new Map(siteIds?siteIds.pageAnchors?.get(page.path):feeds),edits=[],pending=[parse(html,{sourceCodeLocationInfo:true})];
 for(const [prior,copy] of instanceById)ids.set(prior,copy.id);
 for(const id of Object.keys(former.entryDisplays??{}))if(page.entryDisplays)ids.set(id,page.entryDisplays.get(id).slot);
 for(const [i,g] of (page.sourceGalleries??[]).entries()){
  const prior=former.sourceGalleries[i];ids.set(prior.id,g.id);
  for(let j=0;j<g.slots.length;j++)ids.set(prior.slots[j].slotId,g.slots[j].slotId);
 }
 while(pending.length){
  const node=pending.pop(),loc=node.sourceCodeLocation,attrs=attributes(node),instance=instanceById.get(attrs.get('data-website-instance'));
  if(siteIds&&node.tagName==='link'&&attrs.has('data-website-token-sheet')){
   edits.push({from:loc.startOffset,to:loc.endOffset,value:''});continue;
  }
  const feed=feeds.get(attrs.get('data-website-feed'));
  if(instance||feed){
   if(!loc||!loc.endTag&&feed)throw new AppError('FORMAT');
   const value=feed?'<section data-website-feed="'+feed+'"></section>':renderComponentInstance(model.components.get(instance.component),instance,page,model);
   edits.push({from:loc.startOffset,to:loc.endOffset,value});continue;
  }
  for(const a of node.attrs??[]){
   let value=a.value;
   if(managedIdentity.has(a.name))value=ids.get(value)??value;
   else if(siteIds&&['data-website-theme','data-website-theme-sheet','data-website-page-theme'].includes(a.name))value=siteIds.themes.get(value)??value;
   else if(siteIds&&a.name==='data-website-menu-id'){
    if(!siteIds.menus.has(value))siteIds.menus.set(value,randomUUID());
    value=siteIds.menus.get(value);
   }
   else if(generatedReference.has(a.name)&&value.includes('-')){
    const hash=a.name==='href'?value.indexOf('#'):-1;
    const target=a.name==='href'&&hash>0?websiteLocalURL(value,page.path):null;
    const targets=target&&target!==page.path?siteIds?.pageAnchors?.get(target):ids;
    if(targets&&(a.name!=='href'||hash>=0&&(hash===0||target))){
     const start=hash+1;
     value=value.slice(0,start)+value.slice(start).replace(generatedId,(whole,prefix,id)=>targets.has(id)?prefix+targets.get(id):whole);
    }
   }
   if(value===a.value)continue;
   const range=loc?.attrs?.[a.name];if(!range)throw new AppError('FORMAT');
   edits.push({from:range.startOffset,to:range.endOffset,value:a.name+'="'+escapeWebsiteText(value)+'"'});
  }
  if(node.content)pending.push(node.content);
  for(const child of node.childNodes??[])if(child.tagName)pending.push(child);
 }
 const parts=[];let at=0;
 for(const e of edits.sort((a,b)=>a.from-b.from)){parts.push(html.slice(at,e.from),e.value);at=e.to;}
 parts.push(html.slice(at));return parts.join('');
}
function independentInstances(page,owner,includeEntries,components){
 if(owner.instances?.length)page.instances=owner.instances.map(row=>({...row,id:randomUUID(),component:components?.get(row.component)??row.component}));
 if(includeEntries&&owner.sourceGalleries)page.sourceGalleries=owner.sourceGalleries.map(g=>({...g,id:randomUUID(),slots:g.slots.map(s=>({...s,slotId:randomUUID()}))}));
 if(includeEntries&&owner.entryDisplays)page.entryDisplays=new Map(Object.entries(owner.entryDisplays).map(([id,row])=>[id,{...row,slot:randomUUID()}]));
}
export function copiedPageOwner(owner,includeEntries,components){
 const page={path:owner.path,placements:[]};
 for(const key of ['draft','archived','stylePath','sharedDraftBase'])if(owner[key])page[key]=owner[key];
 independentInstances(page,owner,includeEntries,components);
 const anchors=new Map((owner.instances??[]).map((row,i)=>[row.id,page.instances[i].id]));
 for(const [old,row] of page.entryDisplays??[])anchors.set(old,row.slot);
 return {page,anchors};
}
function copyMarkup(html,owner,includeEntries,governed){
 if(includeEntries)return html;
 const document=authoredPageVersion(html,owner.path,governed);
 if(!document)throw new AppError('CONFLICT');return document.chunks.join('');
}
export function copiedComponentHTML(html,ids){
 return independentHTML(html,{},{},{},new Map(),ids);
}
export function duplicateSitePage(original,owner,page,model,ids,governed,includeEntries,scripts){
 let html=copyMarkup(original,owner,includeEntries,governed);
 page.title=includeEntries?owner.title:websiteDocumentTitle(html,owner.path);
 if(ids.feedPaths.size)html=movedWebsiteText(html,owner.path,page.path,ids.feedPaths);
 html=independentHTML(html,page,owner,model,ids.feeds,ids);
 if(page.entryDisplays)page.entryDisplays=Object.fromEntries([...page.entryDisplays.values()].map(row=>[row.slot,row]));
 const pictures=new Set(),recordings=new Set();validateWebsiteHTML(html,{file:page.path,scripts,pictures,recordings});
 page.placements=websiteSourcePlacements(html,includeEntries?owner.placements:[]);
 page.pictures=[...pictures];page.recordings=[...recordings];
 return {page,html};
}
export async function duplicateWebsitePage(store,manifest,owner,{destination,title,includeEntries,signal}){
 const files=new Map(manifest.files.map(f=>[f.name,f])),stylePath=newPageStylesheet(manifest);
 const governed=governedResources(manifest),original=await store.readText(files.get(owner.path),{signal});
 let html=copyMarkup(original,owner,includeEntries,governed);
 const page={path:destination,title,draft:true,stylePath,placements:[]};
 independentInstances(page,owner,includeEntries);
 const feeds=includeEntries?(manifest.feeds??[]).filter(f=>f.path===owner.path):[],feedCopies=duplicatedFeedIds(feeds);
 const moved=new Map(feedCopies.paths);moved.set(owner.path.toLowerCase(),destination);
 html=movedWebsiteText(html,owner.path,destination,moved);
 html=namedWebsitePage(html,title);
 const context=componentContext(manifest);
 context.pages.set(destination,page);context.files.set(destination,{name:destination,draft:true});
 html=independentHTML(html,page,owner,context,feedCopies.ids);
 if(page.entryDisplays)page.entryDisplays=Object.fromEntries([...page.entryDisplays.values()].map(row=>[row.slot,row]));
 const previous=includeEntries?owner.placements.map(row=>row.link?{...row,href:movedWebsiteURL(row.href,owner.path,destination,owner.path,destination)}:row):[];
 page.placements=websiteSourcePlacements(html,previous);
 let css='';
 if(owner.stylePath||owner.draft){
  const prior=owner.stylePath??'draft-styles.css',file=files.get(prior);
  if(file){
   css=await store.readText(file,{signal});
   if(!includeEntries)css=omitPrivateStyleURLs(css,prior,governed);
   css=movedWebsiteText(css,prior,stylePath,owner.path,destination);
   html=switchBaseStyle(html,destination,prior,stylePath);
  }
 }
 html=addPageStyle(html,destination,stylePath);
 const pictures=new Set(),recordings=new Set(),cssPictures=new Set();
 validateWebsiteHTML(html,{file:destination,scripts:await store.scripts(manifest.files),pictures,recordings});
 validateWebsiteCSS(css,{file:stylePath,pictures:cssPictures});
 page.pictures=[...pictures];page.recordings=[...recordings];
 files.set(destination,await store.siteFile(manifest.id,destination,html,{draft:true,signal}));
 files.set(stylePath,await store.siteFile(manifest.id,stylePath,css,{draft:true,signal}));
 const pages=[...manifest.pages,page],sources=[...new Map(pages.flatMap(p=>p.placements.map(({id,revision})=>[id,{id,revision}]))).values()];
 let candidate={...manifest,pages,sources,files:await store.siteAssets([...files.values()],sources,pages)};
 if(cssPictures.size)candidate.pictureStyles={...manifest.pictureStyles,[stylePath]:[...cssPictures]};
 const theme=manifest.themeBook?.pages[owner.path]??files.get(owner.path)?.pageTheme;
 if(theme)candidate.themeBook={...manifest.themeBook,pages:{...manifest.themeBook.pages,[destination]:theme}};
 if(manifest.styleBook?.pages[owner.path])candidate.styleBook={...manifest.styleBook,pages:{...manifest.styleBook.pages,[destination]:manifest.styleBook.pages[owner.path]}};
 for(const feed of feeds)candidate=await duplicateWebsiteFeed(store,candidate,feed,feedCopies.ids.get(feed.id),destination,feedCopies.groups.get(feed.id),signal);
 await store.assertSources(candidate);
 return store.present(await store.commit(candidate,{signal}),destination,{signal});
}
