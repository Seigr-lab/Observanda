import '../i18n/catalogues/inventoryData.js';
import {localBOMResource} from './bom-model.js';
import {validModuleRevision} from './revision.js';
import {decimal} from './quantities.js';
import {inventoryScope} from './inventory-model.js';
import {moduleItemPages} from './item-pages.js';
import {connectedReferencePages} from '../module-connected-references.js';
import {moduleForEntity,enabledModule} from '../feature-modules.js';
import {t} from '../i18n/index.js';
const tr=key=>t('inventoryData',key),token=v=>v===null||typeof v==='string'&&v.length>0&&v.length<=8192;
// Selected stock facts and two independent ledger pages belong to the editor
// lifetime. Responses paint their own read-only regions, never an input form.
export function inventoryClient(c,{card,stock,bom}){
 const {api,state}=c.services;let signature=null,generation=0,controller=null,values=new Map(),loading=false,error=null;
 const pages=new Map(),active=()=>state.page==='module'&&state.moduleId==='resources';
 let connectedId=null;
 const connectedActive=()=>active()&&c.current?.type==='resource'&&c.current.expectedRevision!==null&&c.section==='connections'&&!state.access?.locked&&!state.storageUnavailable;
 const connectedIdentity=()=>JSON.stringify([state.modulePath,c.current?.id,c.section]);
 const connectedKey=()=>JSON.stringify([state.storage?.contextId,state.book.id,state.projectOwner,connectedIdentity()]);
 const aggregate=state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21;
 const drawConnections=()=>{const node=document.querySelector('[data-inventory-links]');if(node&&connectedActive())node.innerHTML=connectionView();};
 const connections=aggregate?connectedReferencePages({state,api,esc:c.esc,prefix:'inventory-links',action:'module-command',active:connectedActive,identity:connectedIdentity,draw:drawConnections}):moduleItemPages({api,workspaceId:state.book.id,esc:c.esc,prefix:'inventory-links',draw:drawConnections});
 function connectionView(){return c.button(t('moduleConnected','refresh'),'inventory-links-refresh',!connectedActive()||connections.busy?'disabled':'')+connections.view(item=>{
  const module=moduleForEntity({type:item.type,data:{}},[]),enabled=module&&enabledModule(state.dashboardSettings,module.id),owner=item.owner&&[item.owner.projectTitle,item.owner.notebookTitle].filter(Boolean).join(' / ');
  const target=item.reference?'data-action="module-reference-open" data-reference-workspace="'+c.esc(item.reference.workspaceId)+'" data-reference-type="'+c.esc(item.reference.type)+'" data-reference-id="'+c.esc(item.reference.id)+'"':'data-action="module-open" data-module-id="'+c.esc(module?.id??'')+'" data-module-path="'+c.esc(item.openType+'/'+item.openId)+'"';
  return '<article class="module-item"><h3>'+c.esc(item.title)+'</h3>'+(owner?'<small>'+c.esc(owner)+'</small>':'')+'<button class="button" type="button" '+target+' '+(enabled?'':'disabled')+'>'+c.esc(t('moduleCurrent','open',{name:item.type}))+'</button></article>';
 });}
 const ids=()=>c.current?(c.current.type==='resource'&&c.current.expectedRevision!==null?[c.current.id]:c.current.type==='bom'?[...new Set(c.current.data.lines.map(l=>localBOMResource(l,state.book.id)).filter(Boolean))]:[]):(c.itemsPage?.items??[]).filter(i=>i.type==='resource').map(i=>i.id);
 async function fetchStock(selected,signal){
  const result=new Map();let revision=null;
  for(let offset=0;offset<selected.length;offset+=25){
   const chunk=selected.slice(offset,offset+25),scope=inventoryScope(state.book,c.scopeId,c.recursive),reply=await api('/api/modules/inventory/stock',{workspaceId:state.book.id,ids:chunk,scopeIds:scope?[...scope]:null},{adopt:false,signal});
   if(reply.workspaceId!==state.book.id||!validModuleRevision(reply.revision)||reply.revision<0||revision!==null&&revision!==reply.revision||!Array.isArray(reply.items)||reply.items.length!==chunk.length||new Set(reply.items.map(i=>i.id)).size!==chunk.length||reply.items.some(i=>!chunk.includes(i.id)||!Number.isSafeInteger(i.revision)||!i.data||!Array.isArray(i.locations)||i.locations.some(row=>!['physical','reserved','available','used','scrapped'].every(k=>decimal(row[k])))))throw Error(tr('invalid'));
   revision=reply.revision;for(const item of reply.items)result.set(item.id,{...item,type:'resource'});
  }
  return result;
 }
 const message=()=>error?`<p role="alert">${c.esc(error.message)}</p>${c.button(tr('retry'),'inventory-retry')}`:loading?`<p role="status">${c.esc(tr('loadingStock'))}</p>`:'';
 function paint(){
  if(!active())return;
  for(const node of document.querySelectorAll('[data-inventory-card]')){const item=values.get(node.dataset.inventoryCard);node.innerHTML=item?card(item,c):message();}
  const region=document.querySelector('[data-inventory-stock]');if(region&&!c.operation)region.innerHTML=loading||error?message():stock(c);
  const preview=document.querySelector('[data-bom-preview]');if(preview){if(c.bomSources?.handles(c.current.data))c.bomSources.paint();else preview.innerHTML=loading||error?message():bom(c.current.data,c);}
  const reserve=document.querySelector('[data-command="bom-reserve"]');if(reserve)reserve.disabled=loading||Boolean(error);
  void c.bindItemLabels();
 }
 function clearPages(){for(const page of pages.values())page.controller?.abort();pages.clear();}
 async function load(){
  controller?.abort();controller=new AbortController();const selected=ids(),ticket=++generation;loading=true;error=null;values.clear();paint();
  try{const result=await fetchStock(selected,controller.signal);if(ticket===generation&&active())values=result;}
  catch(e){if(ticket===generation&&e.name!=='AbortError')error=e;}
  finally{if(ticket===generation){loading=false;paint();}}
 }
 async function ledger(kind,cursor=null){
  const resourceId=c.current?.id;if(!resourceId)return;let page=pages.get(kind);
  if(!page){page={resourceId,result:null,loading:false,error:null};pages.set(kind,page);}page.controller?.abort();const request=new AbortController();page.controller=request;page.loading=true;page.error=null;page.cursor=cursor;paint();
  try{
   const reply=await api('/api/modules/inventory/ledger',{workspaceId:state.book.id,resourceId,kind,cursor,limit:25},{adopt:false,signal:request.signal});
   if(request.signal.aborted||pages.get(kind)!==page||c.current?.id!==resourceId)return;
   if(reply.workspaceId!==state.book.id||!Array.isArray(reply.items)||reply.items.length>25||reply.items.some(i=>i.data?.resourceId!==resourceId||!Number.isSafeInteger(i.revision))||!Number.isSafeInteger(reply.total)||!Number.isSafeInteger(reply.offset)||reply.total<reply.offset+reply.items.length||!Array.isArray(reply.managed)||![reply.cursor,reply.nextCursor,reply.previousCursor].every(token)||(reply.offset>0)!==(reply.previousCursor!==null)||(reply.offset+reply.items.length<reply.total)!==(reply.nextCursor!==null))throw Error(tr('invalid'));
   page.result=reply;
  }catch(e){if(!request.signal.aborted&&pages.get(kind)===page)page.error=e;}
  finally{if(pages.get(kind)===page&&page.controller===request){page.loading=false;paint();}}
 }
 function navigation(kind){
  const page=pages.get(kind),result=page?.result;
  return `${page?.error?`<p role="alert">${c.esc(page.error.message)}</p>`:''}<p role="status">${c.esc(page?.loading?tr('loadingLedger'):result?t('moduleCurrent','range',{first:result.total?result.offset+1:0,last:result.offset+result.items.length,total:result.total}):'')}</p><nav class="module-actions">${c.button(tr('previous'),'inventory-ledger',`data-kind="${kind}" data-direction="previous" ${page?.loading||!result?.previousCursor?'disabled':''}`)}${c.button(tr('next'),'inventory-ledger',`data-kind="${kind}" data-direction="next" ${page?.loading||!result?.nextCursor?'disabled':''}`)}${page?.error?c.button(tr('retry'),'inventory-ledger',`data-kind="${kind}" data-direction="retry"`):''}</nav>`;
 }
 function stop(){generation++;controller?.abort();controller=null;clearPages();values.clear();connections.clear();connectedId=null;signature=null;loading=false;error=null;}
 return {
  get:id=>values.get(id),get loading(){return loading;},get error(){return error;},message,
  async selected(id){return (await fetchStock([id])).get(id);},
  rows:kind=>pages.get(kind)?.result?.items??[],managed:id=>pages.get('reservations')?.result?.managed.includes(id)??false,navigation,connectionView,
  bind(){
   const key=JSON.stringify([state.storage?.contextId,c.scopeId,c.recursive,c.current?.id,ids(),c.snapshot.revisions??c.snapshot.revision,c.current?null:c.itemsPage?.revision]);
   if(signature!==key){signature=key;clearPages();void load();}
   if(c.current?.type==='resource'&&c.current.expectedRevision!==null&&c.section==='stock'&&!c.operation)for(const kind of ['movements','reservations'])if(!pages.has(kind))void ledger(kind);
   if(!connectedActive()){if(connectedId!==null){connections.clear();connectedId=null;}}
   else if(connectedId!==connectedKey()){connections.clear();connectedId=connectedKey();void connections.load({reference:{workspaceId:state.book.id,type:'resource',id:c.current.id}});}
   paint();
  },
  invalidate(){signature=null;clearPages();connections.clear();connectedId=null;},stop,
  async action(name,node){
   if(name.startsWith('inventory-links-')&&!connectedActive())return true;
   if(await connections.action(name))return true;
   if(name==='inventory-retry'){await load();return true;}
   if(name!=='inventory-ledger')return false;
   const kind=node.dataset.kind,page=pages.get(kind);if(!page||page.loading)return true;
   const direction=node.dataset.direction,cursor=direction==='retry'?page.cursor:page.result?.[direction+'Cursor'];if(cursor||direction==='retry')await ledger(kind,cursor);
   document.querySelector('[data-inventory-stock] [data-kind="'+kind+'"][data-direction="'+direction+'"]')?.focus({preventScroll:true});return true;
  }
 };
}
