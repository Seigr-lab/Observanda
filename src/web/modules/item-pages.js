import {validModuleRevision} from './revision.js';
import {t} from '../i18n/index.js';
import {researchId} from '../research-reference.js';
import {ux} from '../experience-ui.js';
const tr=(key,values)=>t('moduleCurrent',key,values),token=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=8192;
export const validModuleSummary=value=>value&&researchId(value.id)&&researchId(value.openId)&&typeof value.openType==='string'&&typeof value.type==='string'&&Number.isSafeInteger(value.revision)&&value.revision>0&&typeof value.title==='string'&&typeof value.description==='string';
export function moduleItemPages({api,workspaceId,esc,draw,prefix='items',action='module-command'}){
 let page=null,error=null,busy=false,query={type:null,query:'',status:''},attempt=null,controller=null,generation=0;
 function cancel(){generation++;controller?.abort();controller=null;busy=false;}
 function clear(){cancel();page=null;error=null;attempt=null;}
 async function load(value=query,cursor=null){
  controller?.abort();const ticket=++generation;controller=new AbortController();busy=true;error=null;query={...value};attempt=()=>load(value,cursor);draw();
  try{
   const result=await api('/api/modules/items',{workspaceId,...value,cursor,limit:25},{signal:controller.signal});
   if(ticket!==generation)return;
   if(result?.workspaceId!==workspaceId||!validModuleRevision(result.revision)||!Array.isArray(result.items)||result.items.length>25||!result.items.every(validModuleSummary)||new Set(result.items.map(v=>v.id)).size!==result.items.length||!Number.isSafeInteger(result.offset)||result.offset<0||!Number.isSafeInteger(result.total)||result.total<result.offset+result.items.length||![result.cursor,result.nextCursor,result.previousCursor].every(token))throw Error(tr('invalid'));
   page=result;attempt=null;
  }catch(e){if(ticket===generation&&e.name!=='AbortError')error=e;}
  finally{if(ticket===generation){busy=false;draw();}}
 }
 const button=(key,command,disabled=false)=>`<button type="button" class="button" data-action="${action}" data-command="${prefix}-${command}" ${disabled?'disabled':''}>${esc(tr(key))}</button>`;
 function view(renderItem){const filtered=Boolean(query.query?.trim()||query.status&&query.status!=='all');return `<section data-module-item-pages aria-busy="${busy}">${error?`<div role="alert">${esc(error.message)}${button('retry','retry',busy)}${button('refresh','refresh',busy)}</div>`:''}<p role="status" tabindex="-1" data-module-items-status>${esc(busy?tr('loading'):error?ux('readFailed'):page?.total?tr('range',{first:page.offset+1,last:page.offset+page.items.length,total:page.total}):page?ux(filtered?'noMatches':'noItems'):tr('loading'))}</p><div class="module-collection">${(page?.items??[]).map(renderItem).join('')}</div>${page?.nextCursor||page?.previousCursor?`<nav class="module-actions" aria-label="${esc(tr('pages'))}">${button('previous','previous',busy||!page?.previousCursor)}${button('next','next',busy||!page?.nextCursor)}</nav>`:''}</section>`;}
 async function handle(name){
  if(!name.startsWith(prefix+'-'))return false;if(busy)return true;
  if(name===prefix+'-next'&&page?.nextCursor)await load(query,page.nextCursor);
  else if(name===prefix+'-previous'&&page?.previousCursor)await load(query,page.previousCursor);
  else if(name===prefix+'-retry')await attempt?.();
  else if(name===prefix+'-refresh')await load();
  document.querySelector('[data-module-items-status]')?.focus({preventScroll:true});return true;
 }
 return {load,view,action:handle,cancel,clear,get page(){return page;},get busy(){return busy;}};
}
