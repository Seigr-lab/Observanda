import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {WebsiteFileContent} from './website-file-store.js';
import {escapeWebsiteText,websiteSourcePlacements,websiteInsertionOffset} from './website-file-html.js';
import {validateWebsiteHTML,websiteFileName} from './website-file-policy.js';
import {attr,descendants,words} from './website-migration-views.js';
import {researchId} from './web/research-reference.js';
import {sourceGalleryItems,galleryKey,itemKey,galleryPart,galleryOverrides,renderGalleryItem} from './website-source-gallery-items.js';

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stylesheet='.website-source-grid{display:grid;gap:1rem;align-items:start}.website-source-grid>figure{margin:0;min-width:0}.website-source-grid img{display:block;max-width:100%;height:auto}'+
 Array.from({length:6},(_,i)=>'.website-source-grid[data-columns="'+(i+1)+'"]{grid-template-columns:repeat('+(i+1)+',minmax(0,1fr))}').join('')+
 '@media(max-width:600px){.website-source-grid[data-columns]{grid-template-columns:1fr}}';
const styleHash=createHash('sha256').update(stylesheet).digest('hex'),styleName='gallery-'+styleHash.slice(0,20)+'.css';
const projections=new WeakMap(),cacheBytes=4*1024*1024,maxEntries=24;
async function currentSource(store,id,revision){
 if(!hex(id)||!hex(revision))throw new AppError('INVALID');
 const source=await store.source(id);
 if(!source?.visible||source.target!=='website')throw new AppError('NOT_FOUND');
 if(source.revision!==revision)throw new AppError('CONFLICT');
 return source;
}
async function readSource(store,id,revision,signal){
 const source=await currentSource(store,id,revision);
 const owner=store.workspace.vault;let cache=projections.get(owner);if(!cache){cache=new Map();projections.set(owner,cache);}
 const key=JSON.stringify([store.workspace.root,id,revision]);
 let held=cache.get(key);
 if(!held){
  const entry={size:0};held=entry;
  entry.pending=(async()=>{
   const items=sourceGalleryItems(await store.readText(source.html),source.assets);
   const order=[...items.values()];
   entry.size=order.reduce((size,item)=>size+256+2*(item.caption.length+item.alt.length+item.asset.length),0);
   if(entry.size>cacheBytes&&cache.get(key)===entry)cache.delete(key);
   let total=0;for(const value of cache.values())total+=value.size;
   while(total>cacheBytes){const [oldest,value]=cache.entries().next().value;total-=value.size;cache.delete(oldest);}
   return {items,order};
  })();
  cache.set(key,entry);if(cache.size>maxEntries)cache.delete(cache.keys().next().value);
  entry.pending.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
 }else{cache.delete(key);cache.set(key,held);}
 const projection=await held.pending;signal?.throwIfAborted();
 return {source,...projection};
}
function publicItem(source,item){
 const {id,revision,title:sourceTitle}=source;
 const {key,kind,alt,caption}=item;
 return {sourceId:id,sourceRevision:revision,sourceTitle,key,kind,alt,caption,previewUrl:'/api/website-files/gallery/image/'+id+'/'+revision+'/'+encodeURIComponent(key)};
}
export function listGalleryItems(store,{sourceId,sourceRevision,offset=0,limit=12,signal}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>40)throw new AppError('INVALID');
 return store.scope(async()=>{
  const {source,order}=await readSource(store,sourceId,sourceRevision,signal);
  const result=order.slice(offset,offset+limit).map(item=>publicItem(source,item));
  await currentSource(store,sourceId,sourceRevision);
  return {items:result,next:offset+limit<order.length?offset+limit:null,revision:sourceRevision};
 },{signal});
}
class GalleryImage extends WebsiteFileContent{
 constructor(store,source,descriptor){super(store,undefined,null,descriptor);this.source=source;}
 async *read(start,end,opts){
  await this.store.scope(()=>currentSource(this.store,this.source.id,this.source.revision),opts);
  for await(const part of super.read(start,end,opts)){
   await this.store.scope(()=>currentSource(this.store,this.source.id,this.source.revision),opts);
   yield part;
  }
 }
}
export function openGalleryImage(store,sourceId,revision,key,signal){
 if(!galleryPart(key))throw new AppError('INVALID');
 return store.scope(async()=>{
  const {source,items}=await readSource(store,sourceId,revision,signal),item=items.get(key);
  if(!item)throw new AppError('NOT_FOUND');
  const descriptor=source.assets.find(f=>f.name===item.asset);
  await currentSource(store,sourceId,revision);
  return {content:new GalleryImage(store,source,descriptor),contentType:descriptor.contentType};
 },{signal});
}
function findGallery(document,id){
 if(!researchId(id))throw new AppError('INVALID');
 const nodes=[...descendants(document)].filter(n=>attr(n,galleryKey)===id);
 if(!nodes.length)throw new AppError('NOT_FOUND');
 if(nodes.length!==1||nodes[0].tagName!=='section')throw new AppError('FORMAT');
 const node=nodes[0];
 for(let parent=node.parentNode;parent;parent=parent.parentNode){
  if(['template','nav','header','footer'].includes(parent.tagName)||parent.attrs?.some(a=>a.name.startsWith('data-observanda-')||['hidden','data-website-instance',galleryKey].includes(a.name)))throw new AppError('CONFLICT');
 }
 const [head,grid,...extra]=node.childNodes.filter(n=>n.tagName);
 if(head?.tagName!=='h2'||grid?.tagName!=='div'||extra.length||!node.sourceCodeLocation?.endTag)throw new AppError('FORMAT');
 const columns=Number(attr(grid,'data-columns'));if(!Number.isInteger(columns)||columns<1||columns>6)throw new AppError('FORMAT');
 return {node,head,grid,columns};
}
async function pageData(store,siteId,{path:pagePath,expectedRevision,galleryId,signal}){
 websiteFileName(pagePath);if(!hex(expectedRevision))throw new AppError('INVALID');
 const manifest=await store.current(siteId,expectedRevision),page=manifest.pages.find(p=>p.path===pagePath);
 if(!page)throw new AppError('NOT_FOUND');
 const html=await store.readText(manifest.files.find(f=>f.name===pagePath),{signal}),document=parse(html,{sourceCodeLocationInfo:true});
 const gallery=galleryId===null?null:findGallery(document,galleryId);
 return {manifest,page,html,document,gallery};
}
export function readSourceGallery(store,siteId,options){
 return store.scope(async()=>{
  const {gallery,manifest,page}=await pageData(store,siteId,options);
  if(!gallery)throw new AppError('INVALID');
  const group=page.sourceGalleries?.find(g=>g.id===options.galleryId);if(!group)throw new AppError('FORMAT');
  const figures=new Map(gallery.grid.childNodes.filter(n=>n.tagName).map(n=>[attr(n,'data-website-source-slot'),n]));
  const items=[],sources=new Map();
  for(const slot of group.slots){
   const figure=figures.get(slot.slotId);
   if(slot.unavailable){if(figure)throw new AppError('FORMAT');items.push({slotId:slot.slotId,unavailable:true});continue;}
   if(!figure)throw new AppError('FORMAT');
   const key=attr(figure,itemKey),id=attr(figure,'data-observanda-source'),revision=attr(figure,'data-observanda-source-revision');
   if(slot.key!==key||slot.sourceId!==id||slot.revision!==revision)throw new AppError('FORMAT');
   if(!sources.has(id))sources.set(id,await readSource(store,id,revision,options.signal));
   const current=sources.get(id),item=current.items.get(key);if(current.source.revision!==revision||!item)throw new AppError('CONFLICT');
   items.push({slotId:slot.slotId,...publicItem(current.source,item),...galleryOverrides(figure)});
  }
  await store.current(siteId,manifest.revision);
  return {galleryId:options.galleryId,heading:words(gallery.head),columns:gallery.columns,items};
 },{signal:options.signal});
}
export function saveSourceGallery(store,siteId,options){
 const {galleryId,heading,columns,items,position='end',signal}=options;
 if(!Array.isArray(items)||!items.length&&galleryId===null||typeof heading!=='string'||heading.length>200||!heading.trim()||!Number.isInteger(columns)||columns<1||columns>6)throw new AppError('INVALID');
 return store.scope(async()=>{
  const {manifest,page,document,gallery,html:original}=await pageData(store,siteId,options);
  const oldGroup=page.sourceGalleries?.find(g=>g.id===galleryId);if(gallery&&!oldGroup)throw new AppError('FORMAT');
  const remaining=new Map(oldGroup?.slots.map(slot=>[slot.slotId,slot])??[]),slots=[];
  const sources=new Map(),rendered=[];let imageBytes=0;
  for(const row of items){
   signal?.throwIfAborted();
   const previous=remaining.get(row?.slotId);
   if(row?.slotId!==undefined){if(!previous)throw new AppError('CONFLICT');remaining.delete(row.slotId);}
   if(row?.unavailable===true){
    if(!previous?.unavailable||Object.keys(row).some(key=>!['slotId','unavailable'].includes(key)))throw new AppError('CONFLICT');
    slots.push(previous);continue;
   }
   if(!row||!galleryPart(row.key)||!hex(row.sourceId)||!hex(row.sourceRevision))throw new AppError('INVALID');
   if(previous&&(previous.unavailable||previous.key!==row.key||previous.sourceId!==row.sourceId))throw new AppError('CONFLICT');
   let current=sources.get(row.sourceId);
   if(!current){current=await readSource(store,row.sourceId,row.sourceRevision,signal);sources.set(row.sourceId,current);}
   if(current.source.revision!==row.sourceRevision)throw new AppError('CONFLICT');
   const item=current.items.get(row.key);if(!item)throw new AppError('NOT_FOUND');
   if(row.altOverride!=null&&(typeof row.altOverride!=='string'||row.altOverride.length>1500)||row.captionOverride!=null&&(typeof row.captionOverride!=='string'||row.captionOverride.length>4000))throw new AppError('INVALID');
   const slotId=previous?.slotId??randomUUID();slots.push({slotId,sourceId:row.sourceId,revision:row.sourceRevision,key:row.key,unavailable:false});
   const markup=renderGalleryItem(item,row.sourceId,row.sourceRevision,page.path,{...row,slotId});
   imageBytes+=Buffer.byteLength(markup);if(imageBytes>16*1024*1024)throw new AppError('LIMIT');rendered.push(markup);
  }
  const id=galleryId??randomUUID();
  const markup=items.length?'<section '+galleryKey+'="'+id+'"><h2>'+escapeWebsiteText(heading.trim())+'</h2><div class="website-source-grid" data-columns="'+columns+'">'+rendered.join('')+'</div></section>':'';
  const loc=gallery?.node.sourceCodeLocation,at=loc?.startOffset??websiteInsertionOffset(document,position);
  let html=original.slice(0,at)+markup+original.slice(loc?.endOffset??at);
  const members=manifest.files.filter(f=>f.name!==page.path),href=path.posix.relative(path.posix.dirname(page.path),styleName);
  const nodes=[...descendants(document)],hasGallery=items.length>0||nodes.some(n=>attr(n,galleryKey)!==undefined&&n!==gallery?.node);
  const hasLink=nodes.some(n=>n.tagName==='link'&&attr(n,'rel')==='stylesheet'&&attr(n,'href')===href);
  if(hasGallery&&!hasLink){
   const head=nodes.find(n=>n.tagName==='head'),htmlTag=nodes.find(n=>n.tagName==='html'),doctype=nodes.find(n=>n.nodeName==='#documentType');
   const atStyle=head?.sourceCodeLocation?.startTag?.endOffset??htmlTag?.sourceCodeLocation?.startTag?.endOffset??doctype?.sourceCodeLocation?.endOffset??0;
   html=html.slice(0,atStyle)+'<link rel="stylesheet" href="'+href+'">'+html.slice(atStyle);
  }
  if(!hasGallery&&hasLink){
   const links=[...descendants(parse(html,{sourceCodeLocationInfo:true}))].filter(n=>n.tagName==='link'&&attr(n,'href')===href&&attr(n,'rel')==='stylesheet');
   for(const link of links.reverse())html=html.slice(0,link.sourceCodeLocation.startOffset)+html.slice(link.sourceCodeLocation.endOffset);
  }
  const placements=websiteSourcePlacements(html,page.placements);
  validateWebsiteHTML(html,{file:page.path,scripts:await store.scripts(members)});
  const groups=(page.sourceGalleries??[]).filter(group=>group.id!==id);if(items.length)groups.push({id,slots});
  const pages=manifest.pages.map(p=>p===page?{...p,placements,sourceGalleries:groups}:p);
  const sheet=members.find(f=>f.name===styleName),uses=pages.filter(p=>p.sourceGalleries?.length),draft=uses.every(p=>p.draft);
  if(sheet&&sheet.sha256!==styleHash)throw new AppError('CONFLICT');
  if(sheet&&(!uses.length||Boolean(sheet.draft)!==draft))members.splice(members.indexOf(sheet),1);
  if(uses.length&&(!sheet||Boolean(sheet.draft)!==draft))members.push(await store.siteFile(siteId,styleName,stylesheet,{signal,draft}));
  const refs=[...new Map(pages.flatMap(p=>p.placements.map(({id,revision})=>[id,{id,revision}]))).values()];
  if(html===original&&JSON.stringify(oldGroup?.slots)===JSON.stringify(slots))return store.present(manifest,page.path,{signal});
  members.push(await store.siteFile(siteId,page.path,html,{signal,draft:page.draft}));
  const files=await store.siteAssets(members,refs,pages);
  return store.present(await store.commit({...manifest,files,pages,sources:refs},{signal}),page.path,{signal});
 },{write:true,signal});
}
