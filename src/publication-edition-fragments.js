import {randomUUID} from 'node:crypto';
import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {assertPublicFields} from './privacy.js';
import {PublicationFeeds} from './publication-feeds.js';
import {publicationCollectionItems,publicationCollectionCount} from './publication-edition-projection.js';
import {defaultFeed} from './web/website-feed-model.js';
import {PUBLIC_COLLECTION_ROWS} from './web/public-collection-pages.js';
import {bookText} from './web/book-messages.js';

// Tokens are local rendering capabilities, never accepted from a saved source.
// Their replacement streams are consumed while the output writer hashes bytes.
export class PublicationFragments{
 constructor(){this.prefix='<!--observanda-'+randomUUID()+'-';this.parts=new Map();}
 add(read){const token=this.prefix+this.parts.size+'-->';this.parts.set(token,read);return token;}
 async *expand(html,overrides=new Map()){
  let at=0;
  while(at<html.length){
   let next=html.length,chosen=null;for(const token of this.parts.keys()){const position=html.indexOf(token,at);if(position>=0&&position<next){next=position;chosen=token;}}
   if(next>at)yield html.slice(at,next);if(!chosen)return;
   yield* (overrides.get(chosen)??this.parts.get(chosen))();at=next+chosen.length;
  }
 }
}
export async function* publicationNavigation(input,{target,prefix,esc,blockedValues=[],signal},parent=null,depth=0){
 if(depth>8)throw new AppError('JOB_DAMAGED');let started=false;
 for await(const item of input.navigation({parent})){
  signal?.throwIfAborted();assertPublicFields([{field:'website navigation',value:item}],blockedValues);
  if(!started){yield '<ul class="site-menu">';started=true;}
  yield '<li><a href="'+esc(prefix+item.path)+'"'+(item.target===target?' aria-current="page"':'')+'>'+esc(item.title)+'</a>';
  const children=publicationNavigation(input,{target,prefix,esc,blockedValues,signal},item.target,depth+1),first=await children.next();
  try{if(!first.done){yield '<details class="site-submenu"><summary aria-label="Pages under '+esc(item.title)+'">&#9662;</summary>';yield first.value;yield* children;yield '</details>';}}finally{await children.return();}
  yield '</li>';
 }
 if(started)yield '</ul>';
}
function projectedCard(kind,value){
 if(kind==='records'){const {id,title,notebookId,occurredOn,status,tags,type,excerpt,hasBody,attachments}=value;return {id,title,notebookId,occurredOn,status,tags,type,excerpt,hasBody,attachments};}
 if(kind==='projects'){const {id,title,description}=value;return {id,title,description};}
 const {id,title,excerpt,hasBody}=value;return {id,title,excerpt,hasBody};
}
export async function publicationEditionParts(input,plan,{writer,media,mediaFiles,context,esc,blockedValues=[],signal,browse=null}){
 const fragments=new PublicationFragments(),feeds=new PublicationFeeds(new Map(),esc),plans=[];let output=null;
 const retainMedia=async(id,kind)=>{signal?.throwIfAborted();const value=await media.get(id,{streamed:true});if(value.kind!==kind)throw new AppError('MEDIA_INVALID');mediaFiles.set(id,value);return value;};
 const drain=async()=>{for(const [name,content] of output?.files??[]){if(/^(media|fonts|figures)\//.test(name)){await writer.retain(name,content);output.files.delete(name);}}};
 const card=async(kind,value,render)=>{
  const item=projectedCard(kind,value),previousMedia=context.website.presentation.media,previousCovers=context.website.presentation.covers,lengths=new Map();
  const includeLink=async link=>{if(!link)return '';const target=link.split('#')[0],value=await input.target(target);if(!value)return '';if(target!=='home'){const [kind]=target.split(':'),key={entry:'entryDestinations',project:'projects',notebook:'notebooks',page:'pages'}[kind],items=context[key];if(!items)throw new AppError('JOB_DAMAGED');if(!lengths.has(key))lengths.set(key,items.length);if(!items.some(item=>item.id===value.id))items.push(value);}return link;};
  try{
   if(kind==='records'){
    const cover=await input.get('covers',item.id);context.website.presentation.covers=cover?[cover]:[];
    const image=cover?item.attachments.find(value=>value.id===cover.attachmentId&&value.kind==='image'):item.attachments.find(value=>value.kind==='image');if(image)await retainMedia(image.id,image.kind);
    const displays=[];for await(const display of input.presentationMedia({scopes:new Set(['cover:'+item.id])}))displays.push({...display,link:await includeLink(display.link)});context.website.presentation.media=displays;
   }else if(kind==='projects'){
    const override=await input.get('branding','project:'+item.id);item.logos=override?.logos??(value.logoId?[{id:value.logoId,alt:value.title}]:[]);item.recordCount=await input.recordCount({projectId:item.id});
    for(const logo of item.logos){const file=await retainMedia(logo.id,'image');await writer.retain('media/'+logo.id+'.png',file.bytes);}
   }
   assertPublicFields([{field:'collection card',recordId:item.id,value:item},{field:'card presentation',value:context.website.presentation.media}],blockedValues);
   const html=render(item);await drain();return html;
  }finally{context.website.presentation.media=previousMedia;context.website.presentation.covers=previousCovers;for(const [key,length] of lengths)context[key].length=length;mediaFiles.clear();}
 };
 const rows=async function*(section,render,values=publicationCollectionItems(input,section,{signal}),limit=Infinity){let count=0;for await(const value of values){if(count++===limit)break;yield await card(section.kind,value,render);}};
 const feedRows=async function*(plan,values){let count=0;for await(const item of values){signal?.throwIfAborted();yield (await card(plan.section.kind,item,plan.card)).replace('<article ','<article data-feed-item data-feed-id="'+esc(item.id)+'" data-feed-search="'+esc(item.title)+'" data-feed-tags="'+esc(JSON.stringify(item.tags??[]))+'" data-feed-type="'+esc(item.type??'')+'" ');if(++count===plan.section.feed.pageSize)break;}};
 const feed=async function*(plan,page,values){
  const marker='<!--rows-'+randomUUID()+'-->',itemCount=Math.max(0,Math.min(plan.section.feed.pageSize,plan.total-page*plan.section.feed.pageSize));
  const html=feeds.fragment({...plan,items:[],windowPage:page,itemCount,rowsHTML:marker},page),at=html.indexOf(marker);
  if(at<0)throw new AppError('JOB_DAMAGED');yield html.slice(0,at);yield* feedRows(plan,values);yield html.slice(at+marker.length);
 };
 signal?.throwIfAborted();
 // One immutable target plan serves its body and reference continuation pages.
 // Keep only its successful scalar totals, including empty collections.
 for(const collection of plan.collections)if(collection.total===undefined)collection.total=await publicationCollectionCount(input,collection.section,{signal});
 const notebookCount=plan.target.startsWith('project:')?await input.count('notebooks',{projectId:plan.target.slice(8),shared:true}):0;
 const addFeed=({section,target,key,pageKey='',render,total,messages})=>{
  const value={id:digest(target+(pageKey?'@'+pageKey:'')+'#'+key),target,key,pageKey,section,card:render,total,pages:Math.max(1,Math.ceil(total/section.feed.pageSize)),messages},token=fragments.add(()=>feed(value,0,publicationCollectionItems(input,section,{signal})));value.token=token;plans.push(value);return token;
 };
 const api={
  fragments,hasFeeds:plan.collections.some(value=>value.section.feed)||notebookCount>PUBLIC_COLLECTION_ROWS,browse,
  attach(value){output=value;},
  navigation:({target,prefix})=>fragments.add(()=>publicationNavigation(input,{target,prefix,esc,blockedValues,signal})),
  collection({section,target,key,prefix,pageKey,card:render}){
   const collection=plan.collections.find(value=>value.key===key);if(!collection)return '';
   if(section.feed)return addFeed({section,target,key,pageKey,render,total:collection.total,messages:feedsMessages});
   return '<div class="publication-cards">'+fragments.add(()=>rows(section,render))+'</div>';
  },
  notebooks({target,pageKey}){
   if(!notebookCount)return '';const section={kind:'notebooks',filter:{projectId:target.slice(8)}};
   const render=item=>'<article class="notebook-link"><a href="../notebooks/'+esc(item.id)+'.html">'+esc(item.title)+'</a></article>';
   let body;
   if(notebookCount>PUBLIC_COLLECTION_ROWS){section.feed={...defaultFeed('pages'),pageSize:PUBLIC_COLLECTION_ROWS,visitorOrder:true,visitorFilters:true};Object.assign(section.feed.labels,{previous:bookText('previousBooks'),next:bookText('nextBooks'),search:bookText('searchBooks')});body='<div class="project-book-directory">'+addFeed({section,target,key:'project-books',pageKey,render,total:notebookCount,messages:{...feedsMessages,...Object.fromEntries(['loading','empty','results','pages'].map(key=>[key,bookText(key+'Books')]))}})+'</div>';}
   else body='<ul class="notebook-list">'+fragments.add(async function*(){for await(const value of input.items('notebooks',{projectId:target.slice(8),shared:true})){assertPublicFields([{field:'lab book title',value:value.title}],blockedValues);yield '<li><a href="../notebooks/'+esc(value.id)+'.html">'+esc(value.title)+'</a></li>';}})+'</ul>';
   return '<section id="page-notebooks"><h2>'+esc(bookText('labBooks'))+'</h2>'+body+'</section>';
  },
  async continuations(name,html){
   const directory=name.slice(0,name.lastIndexOf('/')+1);
   for(const value of plans){
    if(!html.includes(value.token))continue;
    const iterator=publicationCollectionItems(input,value.section,{signal})[Symbol.asyncIterator]();
    try{for(let page=0;page<value.pages;page++){
     const current=page,window=async function*(){for(let count=0;count<value.section.feed.pageSize;count++){const next=await iterator.next();if(next.done)return;yield next.value;}};
     await writer.retain(directory+'feed-'+value.id+'-'+page+'.html',fragments.expand(html,new Map([[value.token,()=>feed(value,current,window())]])));
    }}finally{await iterator.return();}
   }
  }
 };
 return api;
}
import feedsMessages from './web/locales/en/websiteFeeds.json' with {type:'json'};
