// Progressive enhancement of public, independently navigable index files.
// Only a displayed result window and three source pages stay in browser memory.
export function enhancePublicIndex(document,location,history,sessionStorage,window,matchesPublicRecord){
 const form=document.querySelector('[data-book-static]'),list=document.querySelector('[data-book-records]');
 if(!form||!list||!['http:','https:'].includes(location.protocol))return;
 const config=JSON.parse(form.dataset.bookStatic),root=new URL(document.querySelector('[data-book-index]').getAttribute('href'),location.href),key='observanda-public-browse:'+root.pathname;
 const previous=document.querySelector('[data-index-previous]'),next=document.querySelector('[data-index-next]'),status=document.querySelector('[data-index-status]'),cancel=document.querySelector('[data-index-cancel]'),retry=document.querySelector('[data-index-retry]'),empty=document.querySelector('[data-book-empty]');
 const allowed=['q','tag','journey','type','from','to'],defaults=Object.fromEntries(allowed.map(k=>[k,''])),cache=new Map();
 let generation=0,controller=null,pending=null,timer=null,state={...defaults},first=config.page*config.pageSize,last=Math.min(config.total,first+config.pageSize)-1;
 const parse=node=>({node,data:{...node.dataset,text:node.textContent,tags:JSON.parse(node.dataset.tags)}});
 cache.set(config.page,[...list.querySelectorAll('[data-public-record]')].map(parse));
 const validIndex=index=>Number.isSafeInteger(index)&&index>=0&&index<config.pages;
 const load=async(index,signal)=>{
  if(!validIndex(index))throw Error();
  if(cache.has(index)){const value=cache.get(index);cache.delete(index);cache.set(index,value);return value;}
  const url=new URL(index===0?'browse.html':'browse-'+index+'.html',root),response=await window.fetch(url.href,{signal});
  if(!response.ok||response.url&&new URL(response.url).href!==url.href)throw Error();
  const parsed=new window.DOMParser().parseFromString(await response.text(),'text/html'),source=parsed.querySelector('[data-book-static]');if(!source)throw Error();
  const other=JSON.parse(source.dataset.bookStatic);
  if(other.version!==config.version||other.identity!==config.identity||other.page!==index||other.pageSize!==config.pageSize||other.total!==config.total||other.pages!==config.pages)throw Error();
  const rows=[...parsed.querySelectorAll('[data-book-records] [data-public-record]')].map(parse);
  if(rows.length!==Math.min(config.pageSize,config.total-index*config.pageSize))throw Error();
  while(cache.size>=3)cache.delete(cache.keys().next().value);cache.set(index,rows);return rows;
 };
 const queryFor=(query,start)=>{const params=new URLSearchParams();for(const k of allowed)if(query[k])params.set(k,query[k]);if(start)params.set('start',String(start));return params.toString();};
 const remember=()=>{
  const query=queryFor(state,first),rows=[...list.querySelectorAll('[data-public-record]')];
  for(const row of rows){const link=row.querySelector('a'),url=new URL(link.getAttribute('href'),root);if(query)url.searchParams.set('browse',query);else url.searchParams.delete('browse');link.href=url.href;}
  try{sessionStorage.setItem(key,JSON.stringify({query,ids:rows.map(r=>r.dataset.publicRecord),titles:Object.fromEntries(rows.map(r=>[r.dataset.publicRecord,r.querySelector('a').textContent]))}));}catch{}
 };
 const fill=()=>{for(const k of allowed)form.elements[k].value=state[k];};
 const busy=value=>{list.setAttribute('aria-busy',String(value));cancel.hidden=!value;};
 const show=async(start,direction,query,{push=true}={})=>{
  controller?.abort();const request=++generation;controller=new window.AbortController();const {signal}=controller;query={...query};pending={start,direction,query,push};retry.hidden=true;status.textContent=config.messages.indexLoading;busy(true);
  try{
   const selected=[];let at=start;
   for(;at>=0&&at<config.total&&selected.length<config.pageSize;at+=direction){
    const rows=await load(Math.floor(at/config.pageSize),signal);signal.throwIfAborted();const row=rows[at%config.pageSize];
    if(matchesPublicRecord(row.data,query))selected.push({row,at});
   }
   if(request!==generation)return;if(direction<0)selected.reverse();
   list.replaceChildren(...selected.map(({row})=>document.importNode(row.node,true)));
   first=direction>0?start:at-direction;last=direction>0?at-direction:start;state=query;pending=null;
   previous.hidden=first<=0;next.hidden=last>=config.total-1;empty.hidden=selected.length>0;fill();remember();
   const earlier=new URLSearchParams(queryFor(state,0));earlier.set('before',String(first));previous.href=root.pathname+'?'+earlier;
   const later=queryFor(state,Math.min(config.total-1,last+1));next.href=root.pathname+(later?'?'+later:'');
   status.textContent=config.messages.pageRecords+': '+selected.length;if(push){const query=queryFor(state,first);history.pushState(null,'',location.pathname+(query?'?'+query:''));}
  }catch(error){if(request===generation&&error.name!=='AbortError'){status.textContent=config.messages.indexFailed;retry.hidden=false;}}
  finally{if(request===generation)busy(false);}
 };
 const read=()=>Object.fromEntries(allowed.map(k=>[k,form.elements[k].value.trim().slice(0,512)]));
 const apply=event=>{
  event?.preventDefault();window.clearTimeout(timer);if(!form.reportValidity())return;const query=read(),invalid=query.from&&query.to&&query.from>query.to;form.querySelector('[data-filter-error]').hidden=!invalid;if(invalid){controller?.abort();generation++;busy(false);return;}
  const same=other=>allowed.every(k=>other[k]===query[k]);
  // A blur/change followed by submit is one request, even when cached pages
  // finish before the click. Explicit retry still retries failed requests.
  if(pending&&pending.start===0&&pending.direction===1&&same(pending.query)&&!controller.signal.aborted&&retry.hidden||!pending&&first===0&&same(state))return;
  void show(0,1,query);
 };
 const restore=()=>{
  window.clearTimeout(timer);const params=new URLSearchParams(location.search),query=Object.fromEntries(allowed.map(k=>[k,(params.get(k)??'').slice(0,512)])),start=Number(params.get('start')??config.page*config.pageSize);
  const before=Number(params.get('before'));
  if(params.has('before')&&Number.isSafeInteger(before)&&before>0&&before<=config.total)void show(before-1,-1,query,{push:false});
  else void show(Number.isSafeInteger(start)&&start>=0&&start<config.total?start:0,1,query,{push:false});
 };
 form.hidden=false;form.addEventListener('submit',apply);form.addEventListener('change',apply);
 form.addEventListener('input',()=>{window.clearTimeout(timer);controller?.abort();generation++;timer=window.setTimeout(apply,250);});
 form.addEventListener('reset',event=>{event.preventDefault();window.clearTimeout(timer);form.querySelector('[data-filter-error]').hidden=true;void show(0,1,{...defaults});});
 previous.addEventListener('click',event=>{event.preventDefault();window.clearTimeout(timer);void show(first-1,-1,state);});
 next.addEventListener('click',event=>{event.preventDefault();window.clearTimeout(timer);void show(last+1,1,state);});
 cancel.addEventListener('click',()=>{window.clearTimeout(timer);generation++;controller?.abort();pending=null;busy(false);retry.hidden=true;fill();status.textContent=config.messages.pageRecords+': '+list.children.length;});
 retry.addEventListener('click',()=>{if(pending)void show(pending.start,pending.direction,pending.query,{push:pending.push});});
 window.addEventListener('popstate',restore);window.addEventListener('pagehide',()=>{window.clearTimeout(timer);controller?.abort();});
 if(location.search)restore();else remember();
}
