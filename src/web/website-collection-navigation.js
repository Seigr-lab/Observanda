import {sameWebsitePin} from './website-pin.js';
import {REGION_SLOTS,resolveRegion} from './website-regions.js';
import {publicationCollectionKey} from './publication-collections.js';
import {canvasResourceLinks} from './website-canvas-resources.js';

function activeKeys(book,target){
 const [kind,id]=target.split(':'),layout=book.website.layouts.find(value=>value.target===target),original=layout?.placement!=='replace';
 const sources=[{region:'layout',sections:layout?.sections??[]},...REGION_SLOTS.map(region=>({region,sections:resolveRegion(book.website,target,region)?.sections??[]}))];
 if(original)sources.push({region:'',sections:kind==='home'?book.website.home.sections:kind==='page'?book.pages.find(value=>value.id===id)?.sections??[]:[]});
 const keys=new Set(original&&['project','notebook'].includes(kind)?['body']:[]);
 for(const {region,sections} of sources)for(const section of sections){
  if(section.kind!=='records'||!section.show)continue;let parent=section.parentId,visible=true;
  while(parent){const value=sections.find(s=>s.id===parent);if(!value?.show){visible=false;break;}parent=value.parentId;}
  if(visible)keys.add(publicationCollectionKey(section,region));
 }
 return keys;
}

// Reading state belongs to each collection, never to the authored website.
// Feed requests reuse the displayed draft and replace only their own cards.
export class WebsiteCollectionNavigation{
 constructor(api){this.api=api;this.key=null;this.queries=new Map();this.documents=new WeakMap();this.responses=new WeakMap();this.document=null;this.pending=null;this.focus=null;}
 prepare(context,target,source,book){
  const draft=source.draft,pin=source.websitePin;
  // Equivalent pins can arrive with a different JSON property order after an
  // editor checkpoint. Keep every identity field without comparing key order.
  const key=JSON.stringify([context,target,pin?[pin.researchSnapshotId,pin.websiteId,pin.websiteRevision]:null,draft?.baseEtag,draft?.changes,draft?.removed]);
  if(key!==this.key){this.key=key;this.queries.clear();this.pending=null;this.focus=null;}
  const active=activeKeys(book,target);for(const key of this.queries.keys())if(!active.has(key))this.queries.delete(key);
  return {key,context:JSON.parse(context)[0],collections:[...this.queries.values()]};
 }
 attach(doc,command,request){
  if(request.key!==this.key)return;this.document=doc;this.documents.set(doc,{command:structuredClone(command),key:request.key,context:request.context});this.pending=null;
  const definitions=new Map();
  for(const nav of doc.querySelectorAll('[data-collection-definition]'))definitions.set(nav.dataset.recordCollection,nav.dataset.collectionDefinition);
  for(const root of doc.querySelectorAll('[data-public-feed]')){const cursor=JSON.parse(root.dataset.feedConfig).cursor;if(cursor?.definition)definitions.set(cursor.query.key,cursor.definition);}
  for(const [key,value] of this.queries)if(definitions.has(key)&&definitions.get(key)!==value.definition)this.queries.delete(key);
  if(this.focus){const {key,direction}=this.focus,nav=[...doc.querySelectorAll('[data-record-collection]')].find(node=>node.dataset.recordCollection===key),link=nav?.querySelector('[data-collection-'+direction+']')??nav?.querySelector('a');link?.focus({preventScroll:true});nav?.scrollIntoView({block:'nearest'});this.focus=null;}
 }
 reject(request){if(request.key===this.key&&this.pending){this.queries=new Map(this.pending);this.pending=null;this.focus=null;}}
 accept(response){
  const receipt=this.responses.get(response);this.responses.delete(response);if(!receipt)return;
  const {doc,source,key,request,signal}=receipt;
  if(!signal?.aborted&&doc===this.document&&source===this.documents.get(doc)&&source.key===this.key)this.queries.set(key,request);
 }
 click(event,baseURL,refresh){
  const link=event.target.closest('[data-collection-definition] a'),nav=link?.closest('[data-record-collection]');if(!nav)return false;
  const url=new URL(link.getAttribute('href'),baseURL),key=nav.dataset.recordCollection;
  event.preventDefault();event.stopPropagation();this.pending??=[...this.queries];this.focus={key,direction:link.hasAttribute('data-collection-next')?'next':'previous'};
  this.queries.set(key,{key,query:url.searchParams.toString(),definition:nav.dataset.collectionDefinition});refresh();return true;
 }
 async fetch(doc,path,options,baseURL){
  const source=this.documents.get(doc),url=new URL(path,baseURL),key=url.searchParams.get('collection')??url.searchParams.get('feed');
  if(!(source?.command.draft||source?.command.websitePin)||!key)return fetch(path,options);
  const root=[...doc.querySelectorAll('[data-public-feed]')].find(node=>JSON.parse(node.dataset.feedConfig).cursor?.query.key===key),definition=root&&JSON.parse(root.dataset.feedConfig).cursor.definition;
  if(!definition)return fetch(path,options);
  const pagePath=/^\/preview\/[a-f0-9]{64}(\/(?:index\.html|(?:entries|projects|notebooks|pages)\/[a-f0-9-]{36}\.html))$/;
  if(url.origin!==location.origin||!pagePath.test(url.pathname)||pagePath.exec(url.pathname)[1]!==pagePath.exec(new URL(baseURL).pathname)?.[1])throw Error('Invalid canvas destination');
  const request={key,query:url.searchParams.toString(),definition},collections=new Map(this.queries);collections.set(key,request);
  const result=await this.api('/api/design-preview',{...source.command,collections:[...collections.values()]},{adopt:false,signal:options.signal});
  if(source.command.websitePin&&(!sameWebsitePin(result.websitePin,source.command.websitePin)||(result.websiteDraft?.id??null)!==(source.command.websiteDraft?.id??null)||(result.websiteDraft?.revision??null)!==(source.command.websiteDraft?.revision??null)))throw Error('Invalid canvas draft');
  const address=new URL(result.url,location.href),response=await fetch(address,{signal:options.signal});if(!response.ok)return response;
  const parsed=new DOMParser().parseFromString(await response.text(),'text/html');options.signal?.throwIfAborted();
  canvasResourceLinks(parsed,address.href,source.context);
  const prepared=new Response('<!doctype html>'+parsed.documentElement.outerHTML,{headers:{'Content-Type':'text/html'}});
  // The feed controller acknowledges only a fully validated, displayed page.
  // Failed, cancelled and superseded responses must not become saved reading state.
  this.responses.set(prepared,{doc,source,key,request,signal:options.signal});return prepared;
 }
}
