import {parse} from 'parse5';
import {digest} from './storage-format.js';
import {attr} from './website-migration-views.js';
import {displayId} from './website-entry-display.js';
import {galleryKey} from './website-source-gallery-items.js';
import {linkSource} from './website-entry-links.js';
import {websiteLocalURL} from './website-file-policy.js';
import {decodedWebsiteCSS,websiteCSSURLs} from './web/website-css-urls.js';

// Historical HTML holds the author's own bytes. Current grant-owned sections
// are supplied only by the current, authorized page, including in comparison.
function protectedIdentity(node,path,governed){
 const source=attr(node,'data-observanda-source'),link=linkSource(node);
 const gallery=attr(node,galleryKey),feed=attr(node,'data-website-feed');
 let owner;
 if(gallery!==undefined)owner=['gallery',gallery];
 else if(feed!==undefined)owner=['feed',feed];
 else if(link!==undefined)owner=['link',link,attr(node,'data-observanda-link-key')];
 else if(source!==undefined)owner=['source',source,attr(node,displayId),attr(node,'data-website-source-slot'),attr(node,'data-observanda-view'),attr(node,'data-observanda-anchor')];
 else if(node.attrs?.some(a=>a.name.startsWith('data-observanda-')||['data-record-id','data-public-record','data-feed-item','data-website-feed-source'].includes(a.name)))owner=['managed',node.tagName,attr(node,'data-record-id'),attr(node,'data-public-record')];
 if(!owner&&governed?.size){
  const references=[];
  const check=url=>{const name=websiteLocalURL(url,path);if(name&&governed.has(name.toLowerCase()))references.push(name);};
  const style=text=>{for(const url of websiteCSSURLs(decodedWebsiteCSS(text)))check(url);};
  for(const a of node.attrs??[]){
   if(['src','href','poster','srcset','background'].includes(a.name))check(a.value);
   if(a.name==='style')style(a.value);
  }
  if(node.tagName==='style')style((node.childNodes??[]).map(c=>c.value??'').join(''));
  if(references.length)owner=['resource',node.tagName,...references.sort()];
 }
 return owner?{id:digest(JSON.stringify(owner)),kind:owner[0]}:null;
}
function ranges(html,path,governed){
 const pending=[parse(html,{sourceCodeLocationInfo:true})],found=[];
 while(pending.length){
  const node=pending.pop(),protectedPart=protectedIdentity(node,path,governed);
  if(protectedPart){
   const loc=node.sourceCodeLocation;
   // Ambiguous parser recovery must never turn a protected byte into authored
   // history. This page can still be opened from its current saved owner.
   if(!loc||!Number.isSafeInteger(loc.startOffset)||!Number.isSafeInteger(loc.endOffset))return null;
   found.push({...protectedPart,from:loc.startOffset,to:loc.endOffset});continue;
  }
  if(node.content)pending.push(node.content);
  for(const child of node.childNodes??[])if(child.tagName)pending.push(child);
 }
 found.sort((a,b)=>a.from-b.from);
 for(let i=0;i<found.length;i++)if(found[i].from<0||found[i].to<=found[i].from||found[i].to>html.length||i&&found[i-1].to>found[i].from)return null;
 return found;
}
export function authoredPageVersion(html,path,governed){
 const blocks=ranges(html,path,governed);if(!blocks)return null;
 const chunks=[];let at=0;
 for(const block of blocks){chunks.push(html.slice(at,block.from));at=block.to;}
 chunks.push(html.slice(at));
 return {chunks,slots:blocks.map(({id,kind,from,to})=>({id,kind,stamp:digest(html.slice(from,to))}))};
}
export function renderPageVersion(version,current,path,governed){
 const blocks=ranges(current,path,governed);if(!version||!blocks)return {available:false};
 const values=new Map(),counts=new Map();
 for(const [position,{id,kind,from,to}] of blocks.entries()){
  if(!values.has(id))values.set(id,{total:0,byStamp:new Map()});
  const group=values.get(id),body=current.slice(from,to),stamp=digest(body);
  const row=group.byStamp.get(stamp)??{body,stamp,remaining:0,members:[]};row.members.push({position:position+1,kind});
  row.remaining++;group.total++;group.byStamp.set(stamp,row);
 }
 for(const {id} of version.slots)counts.set(id,(counts.get(id)??0)+1);
 const parts=[],sections=[];let unavailable=0,updated=0,used=0;
 for(let i=0;i<version.slots.length;i++){
  const {id,stamp}=version.slots[i],group=values.get(id);
  parts.push(version.chunks[i]);
  // A repeated slot without a persistent instance identity can be matched
  // only by its unchanged current content, never by a guessed position.
  const singleton=counts.get(id)===1&&group?.total===1;
  const row=singleton?group.byStamp.values().next().value:group?.byStamp.get(stamp);
  if(!row?.remaining){unavailable++;sections.push({position:i+1,kind:version.slots[i].kind,reason:'missingGrant'});continue;}
  row.remaining--;used++;row.members.pop();parts.push(row.body);
  if(row.stamp!==stamp){updated++;sections.push({position:i+1,kind:version.slots[i].kind,reason:'updatedGrant'});}
 }
 parts.push(version.chunks.at(-1));
 for(const group of values.values())for(const row of group.byStamp.values())for(const member of row.members)sections.push({...member,reason:'currentGrant'});
 return {available:true,html:parts.join(''),unavailable,updated,currentOnly:blocks.length-used,sections};
}
