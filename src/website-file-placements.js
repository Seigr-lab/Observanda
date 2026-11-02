import path from 'node:path';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {attr,descendants,words} from './website-migration-views.js';
import {linkSource} from './website-entry-links.js';
import {websiteSourcePlacements,websiteInsertionOffset} from './website-file-html.js';
import {websiteFileName,validateWebsiteHTML} from './website-file-policy.js';
import {libraryStamp,checkLibraryStamp} from './website-file-library.js';
import {researchId} from './web/research-reference.js';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const owner=node=>attr(node,'data-observanda-source');
const guarded=node=>['nav','header','footer','template'].includes(node.tagName)||node.attrs?.some(a=>a.name.startsWith('data-observanda-')||['data-website-instance','data-website-menu','data-record-id','data-public-record','hidden'].includes(a.name));
function locationOf(node){
 const indices=[];let heading=null,editable=node.tagName==='section'&&owner(node)!==undefined&&attr(node,'data-observanda-view')===undefined;
 // Generated link labels, component instances and other owners may be
 // nested in an otherwise ordinary section. They need their own lifecycle.
 if(editable)for(const child of descendants(node))if(child!==node&&(linkSource(child)!==undefined||owner(child)!==undefined||attr(child,'data-website-instance')!==undefined)){editable=false;break;}
 for(let child=node;child.parentNode;child=child.parentNode){
  const parent=child.parentNode;
  if(guarded(parent))editable=false;
  if(!heading&&!guarded(parent)){
   const h=(parent.childNodes??[]).find(n=>/^h[1-6]$/.test(n.tagName)&&![...descendants(n)].some(guarded));
   if(h)heading=words(h).replace(/\s+/gu,' ').trim().slice(0,160)||null;
  }
  indices.push(parent.childNodes.filter(n=>n.tagName).indexOf(child));
  if(parent.tagName==='body')return {blockPath:indices.reverse().join('/'),sectionTitle:heading,editable};
 }
 return {blockPath:null,sectionTitle:null,editable:false};
}
function parseLocations(html,page,id,revision){
 const document=parse(html,{sourceCodeLocationInfo:true}),found=[];
 for(const node of descendants(document)){
  const link=linkSource(node)===id;if(!link&&owner(node)!==id)continue;
  if(attr(node,link?'data-observanda-link-revision':'data-observanda-source-revision')!==revision)throw new AppError('CONFLICT');
  found.push({node,kind:link?'link':attr(node,'data-observanda-view')!==undefined||node.tagName!=='section'?'view':'block'});
 }
 const stored=page.placements.filter(p=>p.id===id);
 if(stored.length!==found.length||stored.some((p,i)=>p.revision!==revision||Boolean(p.link)!==(found[i].kind==='link')))throw new AppError('FORMAT');
 return {document,found};
}
async function requireSource(store,sourceId,sourceRevision){
 if(!hex(sourceId)||!hex(sourceRevision))throw new AppError('INVALID');
 const source=await store.source(sourceId);
 if(!source?.visible||source.target!=='website')throw new AppError('NOT_FOUND');
 if(source.revision!==sourceRevision)throw new AppError('CONFLICT');
}
async function openSourceSite(store,id,{sourceId,sourceRevision,expectedRevision}){
 if(!hex(expectedRevision))throw new AppError('INVALID');
 await requireSource(store,sourceId,sourceRevision);return store.current(id,expectedRevision);
}
// The writer registers this source's reverse row before it commits the new
// site head. An interrupted save may therefore leave a row for an absent or
// older site. Only a current authenticated site can contribute a name/count.
export function websitesUsingSource(store,{sourceId,sourceRevision,after=null,limit=8,signal}){
 if(after!==null&&!researchId(after)||!Number.isInteger(limit)||limit<1||limit>24)throw new AppError('INVALID');
 return store.scope(async()=>{
  const stamp=await libraryStamp(store);await requireSource(store,sourceId,sourceRevision);
  const directory='.observanda/website-files/sources/'+sourceId+'/placements',cursor=after===null?null:after+'.json';
  const window=await store.names(directory,{after:cursor,limit,directories:false}),items=[];
  for(const member of window.items){
   signal?.throwIfAborted();
   const siteId=member.slice(0,-5);
   if(!researchId(siteId)||member!==siteId+'.json')throw new AppError('FORMAT');
   const row=await store.control(directory+'/'+member,{missing:true});
   if(!row)continue;
   if(row.siteId!==siteId||row.sourceId!==sourceId)throw new AppError('FORMAT');
   const site=await store.raw(siteId,{missing:true}),placement=site?.sources.find(p=>p.id===sourceId);
   if(!placement||site.sources.some(p=>stamp.pending.has(p.id)))continue;
   if(placement.revision!==sourceRevision)throw new AppError('CONFLICT');
   let total=0,pageCount=0;
   for(const page of site.pages){
    let matched=false;
    for(const p of page.placements)if(p.id===sourceId){
     if(p.revision!==sourceRevision)throw new AppError('CONFLICT');
     matched=true;total++;
    }
    if(matched)pageCount++;
   }
   if(!total){
    const dormant=site.pages.some(page=>page.sourceGalleries?.some(group=>group.slots.some(slot=>slot.sourceId===sourceId&&slot.unavailable)));
    if(dormant)continue;
    throw new AppError('FORMAT');
   }
   items.push({siteId,siteTitle:site.name,revision:site.revision,total,pageCount});
  }
  // Recheck the returned pages of this reverse index only, even for an entry
  // shared by many sites. The file library needs no global site enumeration.
  for(const item of items)if(await store.siteVersion(item.siteId,{signal})!==item.revision)throw new AppError('WEBSITE_CHANGED');
  await checkLibraryStamp(store,stamp);
  return {items,next:window.next?.slice(0,-5)??null,generation:stamp.generation,visibilityToken:stamp.visibilityToken};
 },{signal});
}
export function websiteSourceUsage(store,id,options){
 const {sourceId,sourceRevision,path:currentPage,limit=16,offset=0,signal}=options;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>40)throw new AppError('INVALID');
 if(currentPage!==undefined)websiteFileName(currentPage);
 return store.scope(async()=>{
  const stamp=await libraryStamp(store),manifest=await openSourceSite(store,id,options),items=[];
  let total=0,pageCount=0,onPage=0;
  const files=new Map(manifest.files.map(f=>[f.name,f]));
  for(const page of manifest.pages){
   signal?.throwIfAborted();
   const count=page.placements.reduce((n,p)=>n+Number(p.id===sourceId),0);if(!count)continue;
   pageCount++;if(page.path===currentPage)onPage=count;
   if(total+count>offset&&items.length<limit){
    const {found}=parseLocations(await store.readText(files.get(page.path),{signal}),page,sourceId,sourceRevision);
    for(let ordinal=Math.max(0,offset-total);ordinal<count&&items.length<limit;ordinal++){
     const {node,kind}=found[ordinal];items.push({path:page.path,pageTitle:page.title,draft:Boolean(page.draft),ordinal,kind,...locationOf(node)});
    }
   }
   total+=count;
  }
  await store.current(id,manifest.revision);await checkLibraryStamp(store,stamp);
  return {items,total,pageCount,...(currentPage===undefined?{}:{onPage}),next:offset+items.length<total?offset+items.length:null,revision:manifest.revision,generation:stamp.generation,visibilityToken:stamp.visibilityToken};
 },{signal});
}
function removeStyle(html,page,id){
 const href=path.posix.relative(path.posix.dirname(page),'source-'+id+'.css'),document=parse(html,{sourceCodeLocationInfo:true});
 for(const node of [...descendants(document)].reverse()){
  if(node.tagName==='link'&&node.parentNode?.tagName==='head'&&attr(node,'rel')==='stylesheet'&&attr(node,'href')===href){
   const loc=node.sourceCodeLocation;html=html.slice(0,loc.startOffset)+html.slice(loc.endOffset);
  }
 }
 return html;
}
export function changeWebsitePlacement(store,id,operation,options){
 const {sourceId,sourceRevision,ordinal,path:pagePath,position,signal}=options;
 if(!Number.isInteger(ordinal)||ordinal<0||!['remove','move'].includes(operation)||operation==='remove'&&position!==undefined||operation==='move'&&position===undefined)throw new AppError('INVALID');
 websiteFileName(pagePath);
 return store.scope(async()=>{
  const manifest=await openSourceSite(store,id,options),page=manifest.pages.find(p=>p.path===pagePath);
  if(!page)throw new AppError('NOT_FOUND');
  const previous=await store.readText(manifest.files.find(f=>f.name===pagePath),{signal});
  const {document,found}=parseLocations(previous,page,sourceId,sourceRevision),selected=found[ordinal];
  if(!selected)throw new AppError('NOT_FOUND');
  if(selected.kind!=='block'||!locationOf(selected.node).editable)throw new AppError('CONFLICT');
  const loc=selected.node.sourceCodeLocation;if(!loc?.endTag)throw new AppError('FORMAT');
  const {startOffset:start,endOffset:end}=loc,block=previous.slice(start,end);
  let html=previous.slice(0,start)+previous.slice(end);
  if(operation==='move'){
   const at=websiteInsertionOffset(document,position);
   if(at>start&&at<end)throw new AppError('INVALID');
   const offset=at<=start?at:at-block.length;html=html.slice(0,offset)+block+html.slice(offset);
  }
  if(html===previous)return store.present(manifest,pagePath,{signal});
  const placements=websiteSourcePlacements(html,page.placements),lastOnPage=!placements.some(p=>p.id===sourceId&&!p.link&&!p.gallery);
  if(lastOnPage)html=removeStyle(html,pagePath,sourceId);
  const pictures=new Set(),recordings=new Set();
  validateWebsiteHTML(html,{file:pagePath,scripts:await store.scripts(manifest.files),pictures,recordings});
  const pages=manifest.pages.map(p=>p===page?{...page,placements,pictures:[...pictures],recordings:[...recordings]}:p);
  const sources=[...new Map(pages.flatMap(p=>p.placements.map(({id,revision})=>[id,{id,revision}]))).values()];
  const usedPictures=new Set([...pages.flatMap(p=>p.pictures??[]),...Object.values(manifest.pictureStyles??{}).flat()]),usedRecordings=new Set(pages.flatMap(p=>p.recordings??[]));
  let files=manifest.files.filter(f=>f.name!==pagePath&&(!f.picture||usedPictures.has(f.name))&&(!f.recording||usedRecordings.has(f.name)));
  if(lastOnPage)files=await store.siteAssets(files,sources,pages);
  files.push(await store.siteFile(id,pagePath,html,{signal,draft:page.draft}));
  return store.present(await store.commit({...manifest,files,pages,sources},{signal}),pagePath,{signal});
 },{write:true,signal});
}
