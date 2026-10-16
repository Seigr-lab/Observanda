import {moduleReferenceClient} from './modules/reference-client.js';
import {t} from './i18n/index.js';
const tr=(key,values)=>t('moduleReferenceTargets',key,values);

// One bounded aggregate page. Unavailable owners remain visible as a partial
// result without prompting for unrelated project credentials.
export function connectedReferencePages({state,api,esc,draw,active=()=>['editor','record-reader'].includes(state.page),identity=()=>state.selected,prefix='connected',action:actionName='connected-work-page'}){
 let page=null,error=null,busy=false,controller=null,attempt=null,query=null,generation=0;
 const client=moduleReferenceClient({state,api,identity,active});
 const stamp=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner,identity()]);
 function clear(){generation++;controller?.abort();controller=null;client.cancel();page=null;error=null;busy=false;attempt=null;}
 async function load(options=query,cursor=null){
  controller?.abort();const request=controller=new AbortController(),ticket=++generation,key=stamp(),current=()=>ticket===generation&&key===stamp()&&active()&&!state.access?.locked&&!state.storageUnavailable;query=options;attempt=()=>load(options,cursor);busy=true;error=null;draw();
  try{const result=await client.incoming({...options,target:options.reference,cursor,limit:25},{signal:request.signal});if(current()){page=result;attempt=null;}}
  catch(failure){if(current()&&failure.name!=='AbortError'){error=failure;if(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN','RECORD_QUERY_CURSOR'].includes(failure.code)){page=null;attempt=()=>load(options);}}}
  finally{if(ticket===generation){busy=false;if(current())draw();}}
 }
 const button=(key,command,disabled=false)=>'<button type="button" class="button" data-action="'+esc(actionName)+'" data-command="'+esc(prefix)+'-'+command+'" '+(disabled?'disabled':'')+'>'+esc(tr(key))+'</button>';
 function view(renderItem){return '<section data-module-item-pages aria-busy="'+busy+'">'+(error?'<p role="alert">'+esc(error.message==='MODULE_REFERENCE_RESPONSE'?tr('invalid'):error.message??tr('failed'))+'</p>'+button('retryIncoming','retry',busy):'')+(page?.partial?'<p role="status">'+esc(tr('partial'))+'</p>':'')+'<p role="status">'+esc(busy?tr('loading'):page?.total?tr('range',{first:page.offset+1,last:page.offset+page.items.length,total:page.total}):error?'':tr('empty'))+'</p><div class="module-collection">'+(page?.items??[]).map(renderItem).join('')+'</div><nav class="module-actions">'+button('previous','previous',busy||!page?.previousCursor)+button('next','next',busy||!page?.nextCursor)+'</nav></section>';}
 async function action(name){
  const commands=['next','previous','retry','refresh'];if(!commands.some(command=>name===prefix+'-'+command))return false;
  if(busy)return true;
  if(name===prefix+'-next'&&page?.nextCursor)await load(query,page.nextCursor);
  else if(name===prefix+'-previous'&&page?.previousCursor)await load(query,page.previousCursor);
  else if(name===prefix+'-retry')await attempt?.();
  else if(name===prefix+'-refresh')await load();
  return true;
 }
 return {load,clear,action,view,get busy(){return busy;},get page(){return page;}};
}
