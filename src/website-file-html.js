import {parse,parseFragment,serializeOuter} from 'parse5';
import {createHash} from 'node:crypto';
import {galleryItemPlacement,galleryKey,itemKey} from './website-source-gallery-items.js';
import {displayId,displayMode,displayPlacement,renderEntryPlacement} from './website-entry-display.js';
import {updateMigrationView} from './website-migration-views.js';
import {linkPlacement,linkShape,linkSource,updateEntryLink} from './website-entry-links.js';
import {AppError} from './errors.js';

const attr=(node,name)=>node.attrs?.find(value=>value.name===name)?.value;
const descendants=function*(node){for(const child of node.childNodes??[]){yield child;yield* descendants(child);}};
const location=node=>node?.sourceCodeLocation;
const range=node=>({start:location(node)?.startTag?.endOffset,end:location(node)?.endTag?.startOffset});
const partId=node=>attr(node,'data-observanda-part');
const sourceId=node=>attr(node,'data-observanda-source');
const patches=(html,changes)=>changes.sort((a,b)=>b.start-a.start).reduce((text,change)=>text.slice(0,change.start)+change.text+text.slice(change.end),html);
export const escapeWebsiteText=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function websiteSourcePlacements(html,previous=[]){
 const result=[],keys=new Set(),prior=new Map(previous.filter(item=>item.link).map(item=>[item.link,item]));
 for(const node of descendants(parse(html,{sourceCodeLocationInfo:true}))){
  if(linkSource(node)!==undefined){
   const placement=linkPlacement(node,prior);
   if(keys.has(placement.link)||sourceId(node)!==undefined)throw new AppError('INVALID');
   keys.add(placement.link);result.push(placement);continue;
  }
  const id=sourceId(node);if(id===undefined)continue;
  if(!/^[a-f0-9]{64}$/.test(id)||!range(node).start||!Number.isInteger(range(node).end))throw new AppError('INVALID');
  for(let parent=node.parentNode;parent;parent=parent.parentNode)if(sourceId(parent)!==undefined)throw new AppError('INVALID');
  const revision=attr(node,'data-observanda-source-revision');if(!/^[a-f0-9]{64}$/.test(revision??''))throw new AppError('INVALID');
  result.push({id,revision,...galleryItemPlacement(node),...displayPlacement(node)});
 }
 return result;
}

function partTree(html){
 const root={start:0,end:html.length,append:html.length,html,children:[]};
 function walk(node,parent){
  const id=partId(node),loc=location(node);
  if(id!==undefined){
   if(!id||id.length>200||!loc||!Number.isInteger(loc.startOffset)||!Number.isInteger(loc.endOffset))throw new AppError('INVALID');
   const part={id,start:loc.startOffset,end:loc.endOffset,append:loc.endTag?.startOffset??loc.endOffset,html:html.slice(loc.startOffset,loc.endOffset),children:[]};parent.children.push(part);parent=part;
  }
  for(const child of node.childNodes??[])walk(child,parent);
 }
 walk(parseFragment(html,{sourceCodeLocationInfo:true}),root);return root;
}
function indexed(children){
 const values=new Map(),counts=new Map();for(const child of children){const at=counts.get(child.id)??0;counts.set(child.id,at+1);values.set(child.id+'#'+at,child);}return values;
}
function ownText(part){return patches(part.html,part.children.map(child=>({start:child.start-part.start,end:child.end-part.start,text:''})));}
function mergeParts(current,previous,next,{root=false}={}){
 if(!root&&ownText(previous)!==ownText(next))return next.html;
 const old=indexed(previous.children),incoming=indexed(next.children),authored=indexed(current.children),changes=[];
 for(const [id,child] of authored){
  const candidate=incoming.get(id),before=old.get(id);let replacement;
  if(!candidate)replacement='';
  else if(!before)replacement=candidate.html;
  else replacement=mergeParts(child,before,candidate);
  if(replacement!==child.html)changes.push({start:child.start-current.start,end:child.end-current.start,text:replacement});
 }
 // Honor source order when a formerly private component first appears. Keep
 // author-deleted components absent unless the source actually re-enabled them.
 if(root&&!current.html&&!previous.html)return next.html;
 const inserted=new Map(),sequence=[...incoming.keys()];let anchor=current.children.at(-1)?.end-current.start;if(!Number.isInteger(anchor))anchor=current.append-current.start;
 for(let i=sequence.length-1;i>=0;i--){const id=sequence[i],existing=authored.get(id);
  if(existing)anchor=existing.start-current.start;
  else if(!old.has(id))inserted.set(anchor,incoming.get(id).html+(inserted.get(anchor)??''));
 }
 for(const [start,text] of inserted)changes.push({start,end:start,text});
 if(root&&!incoming.size&&!old.size)return next.html;
 return patches(current.html,changes);
}
export function websiteMarkerShape(html){
 const scopes=[];
 for(const node of descendants(parse(html,{sourceCodeLocationInfo:true}))){
  if(attr(node,galleryKey)!==undefined||attr(node,displayId)!==undefined)scopes.push('managed:'+createHash('sha256').update(serializeOuter(node)).digest('hex'));
  if(linkSource(node)!==undefined){
   let owner,part;for(let parent=node.parentNode;parent;parent=parent.parentNode){part??=partId(parent);owner??=sourceId(parent);}
   scopes.push(JSON.stringify(['link',owner,part,linkShape(node)]));continue;
  }
  const id=sourceId(node);if(id===undefined)continue;const bounds=range(node),keys=[];
  for(const child of descendants(node)){const part=partId(child);if(part!==undefined)keys.push(part);}
  if(!Number.isInteger(bounds.start)||!Number.isInteger(bounds.end))throw new AppError('INVALID');
  scopes.push(id+':'+attr(node,'data-observanda-source-revision')+':'+JSON.stringify(keys.sort())+':'+JSON.stringify((node.attrs??[]).filter(item=>item.name.startsWith('data-observanda-')).map(item=>[item.name,item.value]).sort()));
 }return scopes.sort();
}
// Only explicit source permission writes call this. Ordinary opening, preview
// and publishing read the saved HTML unchanged. Stable component markers let a
// newly allowed/revoked part change without losing its entry's page placement.
export function updateWebsiteSource(html,{id,revision,previousHtml='',html:nextHtml='',visible=true,placements=[],entryDisplays={},displayChoices,page='index.html',title=''}){
 const next=partTree(nextHtml),previous=partTree(previousHtml),changes=[],links=new Map(placements.filter(item=>item.id===id&&item.link).map(item=>[item.link,item])),projection={};
 for(const node of descendants(parse(html,{sourceCodeLocationInfo:true}))){
  if(linkSource(node)===id){
   const loc=location(node);
   changes.push({start:loc.startOffset,end:loc.endOffset,text:updateEntryLink(node,links.get(attr(node,'data-observanda-link-key')),{revision,visible,html:nextHtml,previousHtml},projection)});continue;
  }
  if(sourceId(node)!==id)continue;const bounds=range(node),loc=location(node);
  if(!Number.isInteger(bounds.start)||!Number.isInteger(bounds.end))throw new AppError('INVALID');
  if(attr(node,itemKey)!==undefined)continue;
  const slot=attr(node,displayId);
  if(slot!==undefined){
   const display=entryDisplays[slot];if(!display||display.id!==id||display.presentation!==attr(node,displayMode))throw new AppError('FORMAT');
   changes.push({start:loc.startOffset,end:loc.endOffset,text:renderEntryPlacement(node,{id,revision,title,visible,choices:displayChoices,page,display:{...display,slot}})});continue;
  }
  if(attr(node,'data-observanda-view')){
   changes.push({start:loc.startOffset,end:loc.endOffset,text:updateMigrationView(node,{original:html.slice(loc.startOffset,loc.endOffset),previousHtml,html:nextHtml,visible,revision})});continue;
  }
  const current=partTree(html.slice(bounds.start,bounds.end)),replacement=visible?mergeParts(current,previous,next,{root:true}):'';
  const startTag=html.slice(loc.startOffset,bounds.start).replace(/(data-observanda-source-revision\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i,'$1"'+revision+'"');
  changes.push({start:loc.startOffset,end:bounds.end,text:startTag+replacement});
 }
 return patches(html,changes);
}

export function insertWebsiteSource(html,{position='end',...source}){return insertWebsiteSources(html,[source],position);}
export function websiteInsertionOffset(document,position){
 const body=[...descendants(document)].find(node=>node.tagName==='body');
 // New content belongs in the editable page, ahead of the site's footer.
 // Falling back to body also supports HTML pages without a main landmark.
 const main=body&&[...descendants(body)].find(node=>node.tagName==='main'&&!node.attrs.some(attr=>attr.name==='hidden'));
 const container=main??body,blocks=(container?.childNodes??[]).filter(n=>n.tagName&&!['script','style','link'].includes(n.tagName));
 let at;
 if(position==='end')at=location(container)?.endTag?.startOffset??location(body)?.endTag?.startOffset;
 else if(position==='start')at=location(container)?.startTag?.endOffset??location(blocks[0])?.startOffset??location(body)?.endTag?.startOffset;
 else if(position&&Object.keys(position).length===1&&Number.isInteger(position.before)&&position.before>=0&&position.before<blocks.length)at=location(blocks[position.before])?.startOffset;
 if(!Number.isInteger(at))throw new AppError('INVALID');
 for(let parent=container;parent;parent=parent.parentNode)if(parent.attrs?.some(a=>a.name.startsWith('data-observanda-')||['data-website-instance','data-website-menu','hidden'].includes(a.name))||['nav','header','footer','template'].includes(parent.tagName))throw new AppError('CONFLICT');
 return at;
}
export function insertWebsiteSources(html,sources,position='end'){
 const at=websiteInsertionOffset(parse(html,{sourceCodeLocationInfo:true}),position);
 const fragment=sources.map(({id,revision,html:content})=>'<section data-observanda-source="'+id+'" data-observanda-source-revision="'+revision+'">'+content+'</section>').join('');
 return html.slice(0,at)+fragment+html.slice(at);
}

export function websiteDocumentTitle(html,fallback='Page'){
 const node=[...descendants(parse(html))].find(value=>value.tagName==='title');
 const title=(node?.childNodes??[]).map(value=>value.value??'').join('').trim();return title.slice(0,200)||fallback;
}
