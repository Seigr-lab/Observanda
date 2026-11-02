import path from 'node:path';
import {parse,parseFragment} from 'parse5';
import {AppError} from './errors.js';
import {attr,descendants,words} from './website-migration-views.js';
import {researchId} from './web/research-reference.js';

export const itemKey='data-observanda-gallery-item',galleryKey='data-website-source-gallery';
export const galleryAsset=name=>typeof name==='string'&&/^assets\/[a-f0-9]{64}\.(png|svg)$/.test(name);
export const galleryPart=key=>typeof key==='string'&&/^(media|figure):/.test(key)&&researchId(key.slice(key.indexOf(':')+1));
const escaped=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const hidden=node=>['style','script','template','noscript','audio','video'].includes(node.tagName)||node.attrs?.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true');
const captionTags=new Set(['figcaption','span','em','strong','b','i','sub','sup','small','code','mark']);
function captionText(node){
 if(!node||hidden(node)||attr(node,'data-observanda-part')!==undefined)return '';
 // The publication renderer follows a plot title with result links and
 // summaries in block elements. Keep the caption's own inline content.
 if(node.tagName==='br')return ' ';
 if(node.tagName&&!captionTags.has(node.tagName))return '';
 return node.value??(node.childNodes??[]).map(captionText).join('');
}

// The canonical converter marks individual attachments and figures and rewrites
// their public files to content-addressed names. Neither a bare file descriptor
// nor a matching URL outside a marked part proves that an image can be selected.
export function sourceGalleryItems(html,assets){
 const available=new Map(assets.map(f=>[f.name,f])),items=new Map();
 function visit(node){
  if(hidden(node))return;
  const key=attr(node,'data-observanda-part');
  if(!galleryPart(key)){for(const child of node.childNodes??[])visit(child);return;}
  const kind=key.startsWith('media:')?'photo':'graph';let image,download,caption;
  function inspect(child){
   if(hidden(child)||child!==node&&attr(child,'data-observanda-part')!==undefined)return;
   if(child.tagName==='img'&&!image)image=child;
   if(child.tagName==='a'&&attr(child,'download')!==undefined&&attr(child,'href')?.endsWith('.svg'))download=child;
   if(child.tagName==='figcaption'&&!caption)caption=child;
   for(const member of child.childNodes??[])inspect(member);
  }
  inspect(node);
  const name=kind==='graph'&&download?attr(download,'href'):attr(image,'src'),descriptor=available.get(name);
  const type=kind==='graph'?'image/svg+xml':'image/png',suffix=kind==='graph'?'.svg':'.png';
  if(!galleryAsset(name)||!name.endsWith(suffix)||descriptor?.contentType!==type||descriptor.sha256!==name.slice(7,71))return;
  if(items.has(key))throw new AppError('FORMAT');
  const label=captionText(caption).replace(/\s+/gu,' ').trim();
  items.set(key,{key,kind,asset:name,alt:attr(image,'alt')||label,caption:label});
 }
 visit(parseFragment(html));return items;
}
export function galleryOverrides(node){
 const caption=node.childNodes.find(n=>n.tagName==='figcaption'),image=[...descendants(node)].find(n=>n.tagName==='img');
 return {altOverride:attr(node,'data-observanda-alt-override')===undefined?null:attr(image??{},'alt')??'',
  captionOverride:attr(node,'data-observanda-caption-override')===undefined?null:words(caption??{})};
}
export function renderGalleryItem(item,sourceId,sourceRevision,page,{slotId,altOverride,captionOverride}){
 if(!researchId(slotId))throw new AppError('FORMAT');
 const href=escaped(path.posix.relative(path.posix.dirname(page),item.asset));
 const flags=(altOverride!=null?' data-observanda-alt-override=""':'')+(captionOverride!=null?' data-observanda-caption-override=""':''),caption=captionOverride??item.caption;
 return '<figure data-website-source-slot="'+slotId+'" data-observanda-source="'+sourceId+'" data-observanda-source-revision="'+sourceRevision+'" '+itemKey+'="'+item.key+'" data-observanda-gallery-asset="'+item.asset+'"'+flags+'><a href="'+href+'"><img loading="lazy" src="'+href+'" alt="'+escaped(altOverride??item.alt)+'"></a>'+(caption?'<figcaption>'+escaped(caption)+'</figcaption>':'')+'</figure>';
}
export function galleryItemPlacement(node){
 const key=attr(node,itemKey),asset=attr(node,'data-observanda-gallery-asset');
 if(key===undefined)return null;
 if(node.tagName!=='figure'||!galleryPart(key)||!galleryAsset(asset)||!researchId(attr(node.parentNode?.parentNode??{},galleryKey)))throw new AppError('INVALID');
 return {gallery:key,asset};
}

// Unavailable slots exist only in the encrypted page manifest. The published
// grid contains no placeholder or identifier for a withdrawn item.
export function refreshSourceGalleries(html,page,id,revision,items){
 const groups=page.sourceGalleries??[];
 if(!groups.some(group=>group.slots.some(slot=>slot.sourceId===id)))return {html,groups};
 const document=parse(html,{sourceCodeLocationInfo:true}),containers=new Map(),patches=[];
 for(const node of descendants(document))if(attr(node,galleryKey)!==undefined)containers.set(attr(node,galleryKey),node);
 const next=groups.map(group=>{
  if(!group.slots.some(slot=>slot.sourceId===id))return group;
  const grid=containers.get(group.id)?.childNodes.find(n=>attr(n,'class')==='website-source-grid'),loc=grid?.sourceCodeLocation;
  if(!loc?.endTag)throw new AppError('FORMAT');
  const figures=new Map(grid.childNodes.filter(n=>n.tagName).map(n=>[attr(n,'data-website-source-slot'),n])),markup=[];
  const slots=group.slots.map(slot=>{
   const before=figures.get(slot.slotId);
   if(Boolean(before)===Boolean(slot.unavailable))throw new AppError('FORMAT');
   if(slot.sourceId!==id){
    if(before)markup.push(html.slice(before.sourceCodeLocation.startOffset,before.sourceCodeLocation.endOffset));
    return slot;
   }
   const item=items?.get(slot.key);
   if(item)markup.push(renderGalleryItem(item,id,revision,page.path,{slotId:slot.slotId,...(before?galleryOverrides(before):{})}));
   return {...slot,revision,unavailable:!item};
  });
  patches.push({start:loc.startTag.endOffset,end:loc.endTag.startOffset,text:markup.join('')});
  return {...group,slots};
 });
 for(const patch of patches.sort((a,b)=>b.start-a.start))html=html.slice(0,patch.start)+patch.text+html.slice(patch.end);
 return {html,groups:next};
}
