import {digest} from './storage-format.js';
import messages from './web/locales/en/websiteFeeds.json' with {type:'json'};
import {feedOrders} from './web/website-feed-model.js';
import {enhancePublicFeeds} from './web/public-feeds.js';
import {appearanceFeedParameters} from './appearance-preview-feeds.js';

export const PUBLIC_FEEDS_SCRIPT='('+enhancePublicFeeds.toString()+')(document,window,window.fetch.bind(window));\n';
export const feedFilePath=name=>/^(?:(?:projects|notebooks|entries|pages)\/)?feed-[a-f0-9]{64}-\d+\.html$/.test(name);

// Every published feed retains independently addressable pages. The first page
// is drawn in its owner's composition; fallback pages keep the same complete
// composition and relative links. Visitor filters read one source page at a time.
export class PublicationFeeds{
 constructor(files,esc){this.files=files;this.esc=esc;this.plans=[];}
 render({section,target,key,items,card,continuation=null,pageKey='',messageOverrides={}}){
  const id=digest(target+(pageKey?'@'+pageKey:'')+'#'+key),plan={id,target,pageKey,section,items,card,continuation,messages:{...messages,...messageOverrides},pages:Math.max(1,Math.ceil(items.length/section.feed.pageSize))};
  if(!continuation)this.plans.push(plan);return this.fragment(plan,0);
 }
 fragment(plan,page){
  const {esc}=this,{section,id,items,messages}=plan,feed=section.feed,start=page*feed.pageSize,chosen=items.slice(start,start+feed.pageSize);
  const text=key=>feed.labels[key]||messages[key],input=(key)=>'<label>'+esc(text(key))+'<input name="'+key+'" maxlength="512"></label>';
  const source='feed-'+id+'-',link=index=>source+index+'.html#feed-'+id;
  const continuedLink=cursor=>{const params=appearanceFeedParameters(plan.continuation.visitor);if(cursor){params.set('collection',plan.continuation.key);params.set('cards',cursor);}return '?'+params+'#feed-'+id;};
  const controls=(feed.visitorFilters?input('search')+(section.kind==='records'?input('tag')+input('type'):'')+'<button class="site-visitor-button" type="submit">'+esc(text('apply'))+'</button><button class="site-visitor-button" type="reset">'+esc(text('clear'))+'</button>':'')+
   (feed.visitorOrder?'<label>'+esc(text('order'))+'<select name="order" aria-label="'+esc(text('order'))+'">'+feedOrders(section.kind).map(value=>'<option value="'+value+'"'+(value===feed.order?' selected':'')+'>'+esc(messages[value])+'</option>').join('')+'</select></label>':'')+
   (feed.visitorView?'<label>'+esc(text('view'))+'<select name="view" aria-label="'+esc(text('view'))+'">'+['inherit','grid','list','editorial'].map(value=>'<option value="'+value+'"'+(value===(section.layout??'inherit')?' selected':'')+'>'+esc(messages[value])+'</option>').join('')+'</select></label>':'');
  const config={...feed,kind:section.kind,source,pages:plan.pages,total:items.length,page,layout:section.layout??'inherit',messages};
  if(plan.continuation)config.cursor={href:continuedLink(null),query:plan.continuation.visitor,...(plan.continuation.definition?{definition:plan.continuation.definition}:{})};
  const previous=plan.continuation?plan.continuation.previousCursor:page>0,next=plan.continuation?plan.continuation.nextCursor:page+1<plan.pages;
  const rows=chosen.map(item=>plan.card(item).replace('<article ','<article data-feed-item data-feed-id="'+esc(item.id)+'" data-feed-search="'+esc(item.title)+'" data-feed-tags="'+esc(JSON.stringify(item.tags??[]))+'" data-feed-type="'+esc(item.type??'')+'" ')).join('');
  return '<div id="feed-'+id+'" class="public-feed" data-public-feed="'+id+'" data-feed-config="'+esc(JSON.stringify(config))+'" data-feed-view="'+esc(section.layout??'inherit')+'">'+
   (controls?'<form data-feed-controls hidden>'+controls+'</form>':'')+'<p data-feed-status role="status" hidden></p><button class="site-visitor-button" data-feed-cancel hidden>'+esc(messages.cancel)+'</button><button class="site-visitor-button" data-feed-retry hidden>'+esc(messages.retry)+'</button>'+
   '<div class="publication-cards" data-feed-items>'+rows+'</div><p data-feed-empty'+(chosen.length?' hidden':'')+'>'+esc(plan.continuation?.nextCursor?messages.continueSearch:messages.empty)+'</p>'+
   (feed.navigation?'<nav class="book-page-navigation" aria-label="'+esc(messages.pages)+'"><a data-feed-previous href="'+esc(plan.continuation?continuedLink(previous):link(page-1))+'"'+(!previous?' hidden':'')+'>'+esc(text('previous'))+'</a><a data-feed-next href="'+esc(plan.continuation?continuedLink(next):link(page+1))+'"'+(!next?' hidden':'')+'>'+esc(text('next'))+'</a></nav>':'')+'</div>';
 }
 finishPage(target,name,html){
  const directory=name.slice(0,name.lastIndexOf('/')+1);
  for(const plan of this.plans.filter(plan=>plan.target===target&&(!plan.pageKey||plan.pageKey===name))){
   const initial=this.fragment(plan,0);
   for(let page=0;page<plan.pages;page++)this.files.set(directory+'feed-'+plan.id+'-'+page+'.html',html.replace(initial,this.fragment(plan,page)));
  }
 }
}
