import {parse} from 'parse5';
import path from 'node:path';
import {attr,descendants} from './website-migration-views.js';
import {contentBuffer} from './file-content.js';
import {websiteHTMLByteLimit} from './website-file-policy.js';
import {escapeWebsiteText as esc} from './website-file-html.js';

// A record's website copy keeps a link to another shared record as a marker:
// its words stay, and its destination is the page where the website places
// that record. The website's own files decide this when it is published or
// previewed; no research storage is read. A record the website does not place
// leaves the words without a link.
const MARKER=/^#observanda-record-([0-9a-f-]{36})_([0-9a-f-]{36})(?:~([A-Za-z0-9_:.%-]{1,200}))?$/;
export const recordLinkHref=(workspaceId,recordId,fragment=null)=>'#observanda-record-'+workspaceId+'_'+recordId+(fragment?'~'+fragment:'');
const key=(workspaceId,recordId)=>workspaceId+'_'+recordId;

// The first published page that places each record's visible website copy.
export async function websiteRecordPages(store,manifest,{signal}={}){
 const pages=new Map(),sources=new Map();
 for(const page of manifest.pages){
  if(page.draft)continue;
  for(const row of page.placements){
   if(row.link||row.gallery)continue;signal?.throwIfAborted();
   if(!sources.has(row.id))sources.set(row.id,await store.source(row.id));
   const source=sources.get(row.id),owner=source?.provenance;
   if(!source?.visible||source.target!=='website'||!owner?.workspaceId||!owner?.recordId)continue;
   const id=key(owner.workspaceId,owner.recordId);if(!pages.has(id))pages.set(id,page.path);
  }
 }
 return pages;
}

export function applyRecordLinks(html,file,pages){
 if(!html.includes('#observanda-record-'))return html;
 const edits=[];
 for(const node of descendants(parse(html,{sourceCodeLocationInfo:true}))){
  if(node.tagName!=='a')continue;
  const match=MARKER.exec(attr(node,'href')??''),location=node.sourceCodeLocation;if(!match||!location?.startTag)continue;
  const destination=pages.get(key(match[1],match[2]));
  if(destination){
   const own=path.posix.relative(path.posix.dirname(file),destination),href=(destination===file?'':own)+(match[3]?'#'+match[3]:destination===file?'#':'');
   const at=location.attrs.href;edits.push([at.startOffset,at.endOffset,'href="'+esc(href)+'"']);
  }else if(location.endTag){
   // Not placed on this website: the words remain, without a link.
   edits.push([location.endTag.startOffset,location.endTag.endOffset,''],[location.startTag.startOffset,location.startTag.endOffset,'']);
  }
 }
 let output=html;
 for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]))output=output.slice(0,start)+text+output.slice(end);
 return output;
}

// Applies record links to every page of a published file set.
export async function applyWebsiteRecordLinks(store,manifest,files,{signal}={}){
 let pages=null;
 for(const [name,content] of files){
  if(!name.endsWith('.html'))continue;signal?.throwIfAborted();
  const html=(await contentBuffer(content,{signal,maxBytes:websiteHTMLByteLimit})).toString('utf8');
  if(!html.includes('#observanda-record-'))continue;
  pages??=await websiteRecordPages(store,manifest,{signal});
  const output=applyRecordLinks(html,name,pages);if(output!==html)files.set(name,Buffer.from(output));
 }
}
