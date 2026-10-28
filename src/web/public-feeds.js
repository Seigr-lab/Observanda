// Self-contained controller shared by hosted exports and trusted preview hosts.
// Source pages contain only the already admitted public selection. Filtering
// keeps a bounded page cache and never constructs the complete feed DOM.
export function disposePublicFeeds(document){
 for(const root of document.querySelectorAll('[data-public-feed]'))root.__feedDispose?.();
}

export function enhancePublicFeeds(document,view,fetchPage,{baseURL=view.location.href,history=true,onPageApplied=()=>{}}={}){
 for(const root of document.querySelectorAll('[data-public-feed]')){
  const stamp=root.dataset.feedConfig+'|'+baseURL;if(root.__feedStamp===stamp)continue;
  root.__feedDispose?.();root.__feedStamp=stamp;
  const config=JSON.parse(root.dataset.feedConfig),{messages}=config,id=root.dataset.publicFeed,form=root.querySelector('[data-feed-controls]');
  const items=root.querySelector('[data-feed-items]'),status=root.querySelector('[data-feed-status]'),cancel=root.querySelector('[data-feed-cancel]'),retry=root.querySelector('[data-feed-retry]');
  const previous=root.querySelector('[data-feed-previous]'),next=root.querySelector('[data-feed-next]'),cache=new Map(),listeners=[];
  const on=(node,event,handler)=>{if(node){node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));}};
  const defaults={search:'',tag:'',type:'',order:config.order,view:config.layout};
  let generation=0,controller=null,pending=null,state={...defaults},first=config.page*config.pageSize,last=Math.min(config.total,(config.page+1)*config.pageSize)-1;
  const parse=node=>({node,text:node.dataset.feedSearch??'',tags:JSON.parse(node.dataset.feedTags??'[]'),type:node.dataset.feedType??''});
  cache.set(config.page,[...items.querySelectorAll('[data-feed-item]')].map(parse));
  const fold=value=>value.trim().toLocaleLowerCase('en');
  const matches=(item,query)=>(!query.search||fold(item.text).includes(fold(query.search)))&&(!query.tag||item.tags.some(tag=>fold(tag)===fold(query.tag)))&&(!query.type||fold(item.type)===fold(query.type));
  const load=async(index,signal)=>{
   if(cache.has(index)){const value=cache.get(index);cache.delete(index);cache.set(index,value);return value;}
   const url=new URL(config.source+index+'.html',baseURL);if(url.origin!==view.location.origin)throw Error();
   const response=await fetchPage(url.href,{signal});if(!response.ok||response.url&&new URL(response.url).origin!==url.origin)throw Error();
   const parsed=new view.DOMParser().parseFromString(await response.text(),'text/html'),source=parsed.querySelector('[data-public-feed="'+id+'"]');
   if(!source)throw Error();const details=JSON.parse(source.dataset.feedConfig);
   if(details.page!==index||details.total!==config.total||details.pageSize!==config.pageSize||details.source!==config.source)throw Error();
   const value=[...source.querySelectorAll('[data-feed-item]')].map(parse);
   if(value.length!==Math.min(config.pageSize,config.total-index*config.pageSize))throw Error();
   while(cache.size>=3)cache.delete(cache.keys().next().value);cache.set(index,value);return value;
  };
  const busy=value=>{cancel.hidden=!value;root.setAttribute('aria-busy',String(value));};
  const fillForm=()=>{for(const key of Object.keys(state)){const input=form?.elements.namedItem(key);if(input)input.value=state[key];}};
  const writeLocation=()=>{if(history){const url=new URL(view.location.href);url.searchParams.set('feed-'+id,JSON.stringify({...state,start:first}));view.history.pushState(null,'',url);}};
  const showCursor=async(path,query=state)=>{
   controller?.abort();const request=++generation;controller=new view.AbortController();query={...query};pending={path,query};retry.hidden=true;status.hidden=false;status.textContent=messages.loading;busy(true);
   try{
    const url=new URL(path,baseURL);if(url.origin!==view.location.origin)throw Error();
    const response=await fetchPage(url.href,{signal:controller.signal});if(!response.ok||response.url&&new URL(response.url).origin!==url.origin)throw Error();
    const parsed=new view.DOMParser().parseFromString(await response.text(),'text/html'),source=parsed.querySelector('[data-public-feed="'+id+'"]');if(!source)throw Error();
    const details=JSON.parse(source.dataset.feedConfig);
    // Cursor previews scope asset paths to the displayed page, so their source
    // path changes on continuation. The feed identity and query key stay fixed.
    if(!details.cursor||details.pageSize!==config.pageSize||details.kind!==config.kind||details.cursor.query?.key!==config.cursor.query?.key)throw Error();
    const sourceItems=source.querySelector('[data-feed-items]'),sourceEmpty=source.querySelector('[data-feed-empty]'),navigation=[];
    if(!sourceItems||!sourceEmpty||sourceItems.children.length>config.pageSize||[...sourceItems.children].some(node=>!node.hasAttribute('data-feed-item')))throw Error();
    for(const [button,key] of [[previous,'previous'],[next,'next']])if(button){
     const other=source.querySelector('[data-feed-'+key+']'),href=other?.getAttribute('href');if(!href)throw Error();
     const destination=new URL(href,baseURL);if(destination.origin!==view.location.origin)throw Error();
     navigation.push({button,hidden:other.hidden,href:destination.href});
    }
    // Prepare the complete replacement before changing any visible result or
    // navigation state. A truncated response must leave the prior view intact.
    const nodes=[...sourceItems.children].map(node=>document.importNode(node,true));
    if(request!==generation)return;controller.signal.throwIfAborted();
    items.replaceChildren(...nodes);for(const {button,hidden,href} of navigation){button.hidden=hidden;button.href=href;}
    state=query;root.dataset.feedView=state.view;const empty=root.querySelector('[data-feed-empty]');empty.hidden=nodes.length>0;empty.textContent=sourceEmpty.textContent;fillForm();status.textContent=messages.results+': '+nodes.length;pending=null;onPageApplied(response);
   }catch(error){if(request===generation&&error.name!=='AbortError'){status.textContent=messages.failed;retry.hidden=false;}}
   finally{if(request===generation)busy(false);}
  };
  const show=async(start,direction,query=state,{remember=true}={})=>{
   controller?.abort();const request=++generation;controller=new view.AbortController();const {signal}=controller;query={...query};pending={start,direction,query,remember};retry.hidden=true;status.hidden=false;status.textContent=messages.loading;busy(true);
   try{
    const selected=[];let at=start;
    for(;at>=0&&at<config.total&&selected.length<config.pageSize;at+=direction){
     const rows=await load(Math.floor(at/config.pageSize),signal);signal.throwIfAborted();const item=rows[at%config.pageSize];if(matches(item,query))selected.push({item,at});
    }
    if(request!==generation)return;
    const reversed=query.order!==config.order;if(direction===(reversed?1:-1))selected.reverse();
    items.replaceChildren(...selected.map(({item})=>document.importNode(item.node,true)));
    const step=reversed?-1:1;first=direction===step?start:at-direction;last=direction===step?at-direction:start;state=query;
    if(previous)previous.hidden=reversed?first>=config.total-1:first<=0;
    if(next)next.hidden=reversed?last<=0:last>=config.total-1;
    root.dataset.feedView=state.view;root.querySelector('[data-feed-empty]').hidden=selected.length>0;
    fillForm();status.textContent=messages.results+': '+selected.length;pending=null;if(remember)writeLocation();
   }catch(error){if(request===generation&&error.name!=='AbortError'){status.textContent=messages.failed;retry.hidden=false;}}
   finally{if(request===generation)busy(false);}
  };
  const restart=query=>{
   if(config.cursor){const url=new URL(config.cursor.href,baseURL);for(const key of ['search','tag','type','order'])url.searchParams.set('feed'+key[0].toUpperCase()+key.slice(1),query[key]);return showCursor(url.href,query);}
   const reverse=query.order!==config.order;return show(reverse?config.total-1:0,reverse?-1:1,query);
  };
  const read=()=>{const query={...state};for(const key of Object.keys(query))if(form?.elements.namedItem(key))query[key]=form.elements.namedItem(key).value;return query;};
  const restore=()=>{
   let query={...defaults,start:config.page*config.pageSize};
   try{
    const value=JSON.parse(new URL(view.location.href).searchParams.get('feed-'+id)),orders=config.kind==='records'?['newest','oldest']:['alphabetical','reverse-alphabetical'];
    if(value&&Number.isSafeInteger(value.start)&&value.start>=0&&value.start<Math.max(1,config.total)&&['search','tag','type'].every(key=>typeof value[key]==='string'&&value[key].length<=512)&&orders.includes(value.order)&&['inherit','grid','list','editorial'].includes(value.view)){
     query={...query,start:value.start};if(config.visitorOrder)query.order=value.order;if(config.visitorFilters)for(const key of ['search','tag','type'])query[key]=value[key];if(config.visitorView)query.view=value.view;
    }
   }catch{}
   const {start,...values}=query;void show(start,values.order===config.order?1:-1,values,{remember:false});
  };
  if(form){
   form.hidden=false;
   const apply=event=>{event.preventDefault();void restart(read());};
   on(form,'submit',apply);on(form.querySelector('[type="submit"]'),'click',apply);
   on(form,'keydown',event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT')apply(event);});
   on(form,'change',event=>{if(event.target.name==='order')void restart(read());else if(event.target.name==='view'){state={...state,view:event.target.value};root.dataset.feedView=state.view;writeLocation();}});
   const reset=event=>{event.preventDefault();void restart({...defaults});};on(form,'reset',reset);on(form.querySelector('[type="reset"]'),'click',reset);
  }
  on(next,'click',event=>{event.preventDefault();if(config.cursor)void showCursor(next.href);else void show(last+(state.order===config.order?1:-1),state.order===config.order?1:-1);});
  on(previous,'click',event=>{event.preventDefault();if(config.cursor)void showCursor(previous.href);else void show(first+(state.order===config.order?-1:1),state.order===config.order?-1:1);});
  on(cancel,'click',()=>{generation++;controller?.abort();pending=null;busy(false);status.hidden=true;retry.hidden=true;fillForm();});
  on(retry,'click',()=>{if(pending){if(pending.path)void showCursor(pending.path,pending.query);else void show(pending.start,pending.direction,pending.query,{remember:pending.remember});}});
  on(view,'pagehide',()=>controller?.abort());if(history)on(view,'popstate',restore);
  root.__feedDispose=()=>{generation++;controller?.abort();listeners.forEach(dispose=>dispose());delete root.__feedStamp;delete root.__feedDispose;};
  if(config.cursor){state={...defaults,...config.cursor.query};fillForm();}
  if(history&&new URL(view.location.href).searchParams.has('feed-'+id))restore();
 }
}
