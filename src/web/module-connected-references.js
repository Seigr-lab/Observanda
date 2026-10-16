import {moduleReferenceClient} from './modules/reference-client.js';
import {t} from './i18n/index.js';
const tr=(key,values)=>t('moduleReferenceTargets',key,values);

// One bounded aggregate page. Unavailable owners remain visible as a partial
// result without prompting for unrelated project credentials.
export function connectedReferencePages({state,api,esc,draw}){
 let page=null,error=null,busy=false,controller=null,attempt=null,query=null,generation=0;
 const client=moduleReferenceClient({state,api,identity:()=>state.selected,active:()=>['editor','record-reader'].includes(state.page)});
 function clear(){generation++;controller?.abort();controller=null;client.cancel();page=null;error=null;busy=false;attempt=null;}
 async function load(options=query,cursor=null){
  controller?.abort();const request=controller=new AbortController(),ticket=++generation;query=options;attempt=()=>load(options,cursor);busy=true;error=null;draw();
  try{const result=await client.incoming({...options,target:options.reference,cursor,limit:25},{signal:request.signal});if(ticket===generation){page=result;attempt=null;}}
  catch(failure){if(ticket===generation&&failure.name!=='AbortError')error=failure;}
  finally{if(ticket===generation){busy=false;draw();}}
 }
 const button=(key,command,disabled=false)=>'<button type="button" class="button" data-action="connected-work-page" data-command="connected-'+command+'" '+(disabled?'disabled':'')+'>'+esc(tr(key))+'</button>';
 function view(renderItem){return '<section data-module-item-pages aria-busy="'+busy+'">'+(error?'<p role="alert">'+esc(error.message==='MODULE_REFERENCE_RESPONSE'?tr('invalid'):error.message??tr('failed'))+'</p>'+button('retryIncoming','retry',busy):'')+(page?.partial?'<p role="status">'+esc(tr('partial'))+'</p>':'')+'<p role="status">'+esc(busy?tr('loading'):page?.total?tr('range',{first:page.offset+1,last:page.offset+page.items.length,total:page.total}):tr('empty'))+'</p><div class="module-collection">'+(page?.items??[]).map(renderItem).join('')+'</div><nav class="module-actions">'+button('previous','previous',busy||!page?.previousCursor)+button('next','next',busy||!page?.nextCursor)+'</nav></section>';}
 async function action(name){
  if(busy)return true;
  if(name==='connected-next'&&page?.nextCursor)await load(query,page.nextCursor);
  else if(name==='connected-previous'&&page?.previousCursor)await load(query,page.previousCursor);
  else if(name==='connected-retry')await attempt?.();
  else if(name==='connected-refresh')await load();
  return true;
 }
 return {load,clear,action,view,get busy(){return busy;},get page(){return page;}};
}
