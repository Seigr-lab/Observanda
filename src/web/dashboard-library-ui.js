import {projectContextAPI} from './project-context.js';
import {cardIcon} from './dashboard-cards.js';
import {DISCOVERY_PAGE_SIZE as size,discoveryMatches,validDiscoveryPage} from './data-discovery.js';
import {t,messageLanguage} from './i18n/index.js';

// Discovery owns its search and bounded provider pages. Dashboard cards keep
// their independent provider data, filters and layout state.
export function dashboardLibraryUI({registry,context,session,api,esc,button,iconButton,closedCards,shortcuts,access=operation=>operation()}){
 let opened=false,search='',category='all',page=0,identity='',focusPage=false,timer=null;
 const cache=new Map(),text=(key,params)=>esc(t('dashboardLibrary',key,params)),attrs=value=>esc(JSON.stringify(value));
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function clear(){clearTimeout(timer);for(const value of cache.values())value.controller?.abort();cache.clear();}
 function close(){opened=false;clear();identity='';focusPage=false;}
 function open(mode='all'){clear();opened=true;category=mode;search='';page=0;focusPage=false;}
 function sync(){const c=context(),key=JSON.stringify([c.book.id,c.etag,c.outline,registry.all().map(p=>p.id),search,category]);if(identity!==key){clear();identity=key;page=0;}}
 function result(provider,offset=0){
  const c=context();
  if(!c.outline||!provider.discover||provider.canDiscover&&!provider.canDiscover(c)){
   const value=session().read(provider.id);if(value.status!=='ready')return value;
   const items=value.items.filter(item=>discoveryMatches({title:item.title,subtitle:provider.label+' '+(item.subtitle??'')},search));
   return {status:'ready',items:items.slice(offset,offset+size).map(({key,title,subtitle})=>({key,title,subtitle})),total:items.length,offset};
  }
  let value=cache.get(provider.id);
  if(!value||value.offset!==offset){
   value?.controller.abort();const previous=value;
   value={status:'loading',offset,total:previous?.total,cursor:previous?.cursor??null,controller:new AbortController()};cache.set(provider.id,value);
   const query={context:c,search:search.trim().split(/\s+/).filter(word=>!provider.label.toLocaleLowerCase().includes(word.toLocaleLowerCase())).join(' '),offset,limit:size,cursor:value.cursor,signal:value.controller.signal,api:projectContextAPI(api,c)};
   value.execute=async authorize=>{
    if(!opened||cache.get(provider.id)!==value)return;
    const previousError=value.error;value.status='loading';value.error=null;
    try{
     const run=()=>{query.signal.throwIfAborted();return provider.discover(query);},data=await (authorize?access(run):run());
     if(!validDiscoveryPage(data,query))throw Error(t('dashboardLibrary','invalidPage'));
     if(cache.get(provider.id)===value)Object.assign(value,{items:data.items.map(({key,title,subtitle})=>({key,title,subtitle})),total:data.total,cursor:data.cursor??null,status:'ready'});
    }catch(error){if(cache.get(provider.id)===value){value.status='error';value.error=error.name==='AbortError'&&previousError?previousError:error;}}
    finally{if(opened&&cache.get(provider.id)===value)refresh();}
   };
   void Promise.resolve().then(()=>value.execute(false));
  }
  return value;
 }
 function contents(){
  const groups=[],rows=[];let total=0,loading=false,error=null;
  const addLocal=items=>{groups.push({start:total,total:items.length,items});total+=items.length;};
  for(const p of registry.all()){
   if(!['all','collections',p.id].includes(category))continue;
   if(discoveryMatches({title:p.label,subtitle:p.group??''},search))addLocal([{source:{provider:p.id,key:null},label:p.label,description:p.group??'',icon:p.icon}]);
   if(category==='collections')continue;
   // Totals are independent of the retained page. Never reset a provider to
   // its first page merely to count it while another page is displayed.
   const value=result(p,cache.get(p.id)?.offset??0);
   if(value.status==='error')error??=value.error;
   if(value.total===undefined)loading=true;
   groups.push({start:total,total:value.total??0,provider:p});total+=value.total??0;
  }
  if(category==='all'||category==='closed')addLocal(closedCards().filter(row=>discoveryMatches({title:row.label,subtitle:row.description},search)));
  if(error)return `<p role="alert">${esc(error.message||t('dashboardLibrary','loadFailed'))}</p>${button(text('retry'),'dashboard-library-retry')}`;
  if(!loading){
   page=Math.min(page,Math.max(0,Math.ceil(total/size)-1));const start=page*size,end=start+size;
   for(const group of groups){
    if(group.start>=end||group.start+group.total<=start)continue;
    const offset=Math.max(0,start-group.start),count=Math.min(end-Math.max(start,group.start),group.total-offset);
    if(group.items)rows.push(...group.items.slice(offset,offset+count));
    else{
     const value=result(group.provider,offset);
     if(value.status==='error')error??=value.error;
     else if(value.status!=='ready')loading=true;
     else rows.push(...value.items.slice(0,count).map(item=>({source:{provider:group.provider.id,key:item.key},label:item.title,description:group.provider.label+(item.subtitle?' · '+item.subtitle:''),icon:group.provider.icon})));
    }
   }
  }
  if(error)return `<p role="alert">${esc(error.message||t('dashboardLibrary','loadFailed'))}</p>${button(text('retry'),'dashboard-library-retry')}`;
  if(loading)return `<p role="status">${text('loading')}</p>`;
  return `<div class="desk-library-items">${rows.map(row=>{
   const pinned=shortcuts().some(s=>equal(s.source,row.source)&&(!s.workspaceId||s.workspaceId===context().book.id));
   return `<div class="desk-library-item">${button(cardIcon(row.icon)+`<span><strong>${esc(row.label)}</strong><small>${esc(row.description)}</small></span>`,'dashboard-add',`data-desk-tool="${attrs(row.source)}" data-source="${attrs(row.source)}" data-restore="${row.restore??''}" data-label="${esc(row.label)}"`)}${button(pinned?'★':'☆','dashboard-pin',`data-source="${attrs(row.source)}" aria-label="${text(pinned?'unpin':'pin',{name:row.label})}" aria-pressed="${pinned}"`,'desk-icon')}</div>`;
  }).join('')||`<p>${text('empty')}</p>`}</div><footer><span tabindex="-1" data-discovery-page>${text('range',{first:total?page*size+1:0,last:Math.min(total,(page+1)*size),total})}</span>${button(text('previous'),'dashboard-library-prev',page===0?'disabled':'')}${button(text('next'),'dashboard-library-next',(page+1)*size>=total?'disabled':'')}</footer>`;
 }
 function view(){
  if(!opened)return '';sync();
  return `<section class="desk-library" lang="${messageLanguage('dashboardLibrary')}" aria-label="${text('region')}"><header><label class="desk-library-search"><span class="website-visually-hidden">${text('find')}</span><input type="search" maxlength="512" data-desk-search placeholder="${text('placeholder')}" value="${esc(search)}"></label><label>${text('show')}<select aria-label="${text('show')}" data-desk-category>${[['all',t('dashboardLibrary','all')],['collections',t('dashboardLibrary','collections')],['closed',t('dashboardLibrary','closed')],...registry.all().map(p=>[p.id,p.label])].map(([id,label])=>`<option value="${id}" ${category===id?'selected':''}>${esc(label)}</option>`).join('')}</select></label><span>${text('hint')}</span>${iconButton('close',t('dashboardLibrary','close'),'dashboard-library-close')}</header>${contents()}</section>`;
 }
 function refresh(){
  const node=document.querySelector('#desk-library-slot');if(!node)return;
  const focused=document.activeElement,searchFocused=focused?.hasAttribute('data-desk-search'),categoryFocused=focused?.hasAttribute('data-desk-category'),position=focused?.selectionStart;
  document.querySelector('[data-action="dashboard-library"]')?.setAttribute('aria-expanded',String(opened));node.innerHTML=view();
  if(searchFocused){const input=node.querySelector('[data-desk-search]');input?.focus({preventScroll:true});if(input&&position!==null)input.setSelectionRange(position,position);}
  else if(categoryFocused)node.querySelector('[data-desk-category]')?.focus({preventScroll:true});
  else if(focusPage){const target=node.querySelector('[data-discovery-page], [data-action="dashboard-library-retry"]');if(target){target.focus({preventScroll:true});focusPage=false;}}
 }
 function input(el){
  if(el.hasAttribute('data-desk-search')){search=el.value;page=0;clear();timer=setTimeout(refresh,180);return true;}
  if(el.hasAttribute('data-desk-category')){category=el.value;page=0;clear();refresh();return true;}
  return false;
 }
 async function action(el){
  const name=el.dataset.action;
  if(name==='dashboard-library-next'||name==='dashboard-library-prev'){page+=name.endsWith('next')?1:-1;focusPage=true;refresh();return true;}
  if(name==='dashboard-library-retry'){focusPage=true;for(const value of [...cache.values()])if(value.status==='error'){const request=value.execute(true);refresh();await request;}await session().retry();refresh();return true;}
  return false;
 }
 return {view,refresh,input,action,open,close,isOpen:()=>opened};
}
