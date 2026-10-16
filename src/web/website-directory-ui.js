import {t} from './i18n/index.js';
import {researchId} from './research-reference.js';
const tr=(key,values)=>t('websiteSites',key,values);
export function websiteDirectoryUI({state,api,esc,access=operation=>operation(),open}){
 let identity='',filter=null,page=null,search='',cursor=null,status='loading',controller=null,timer=null;
 const root=()=>document.querySelector('[data-website-directory]');
 const active=()=>state.page==='websites'&&!state.access?.locked&&!state.storageUnavailable&&!state.projectOwner?.labBookId&&!!root();
 const key=()=>JSON.stringify([state.storage?.contextId,state.book.id,state.projectOwner?.projectId??null,filter]);
 function stop(){controller?.abort();controller=null;clearTimeout(timer);timer=null;}
 function clear(){stop();identity='';page=null;search='';cursor=null;status='loading';}
 function paint(){
  const host=root();if(!host||!active())return;
  host.querySelector('[data-website-directory-items]').innerHTML=(page?.items??[]).map(item=>'<section class="panel"><h2>'+esc(item.siteId?item.name:tr('ownerWebsite',{name:item.ownerLabel}))+'</h2>'+(item.siteId?'<p>'+esc(item.ownerLabel)+'</p>':'')+'<button type="button" class="button" data-action="site-owner-open" data-key="'+esc(item.key)+'">'+esc(tr('editor'))+'</button></section>').join('');
  const message=host.querySelector('[data-website-directory-status]');message.textContent=tr(status==='error'?'directoryFailed':status==='loading'?'directoryLoading':page.total?'directoryRange':'empty',page?{first:page.offset+1,last:page.offset+page.items.length,total:page.total}:{});message.setAttribute('role',status==='error'?'alert':'status');
  const retry=host.querySelector('[data-action=site-directory-retry]');retry.hidden=status!=='error';
  for(const direction of ['previous','next']){const button=host.querySelector('[data-action=site-directory-'+direction+']');button.hidden=!page?.previousCursor&&!page?.nextCursor;button.disabled=status==='loading'||!page?.[direction+'Cursor'];}
 }
 async function load(unlock=false){
  stop();if(!active())return;const request=new AbortController();controller=request;const stamp=identity;status='loading';paint();
  const valid=()=>!request.signal.aborted&&active()&&identity===stamp&&key()===stamp;
  try{
   const run=()=>{request.signal.throwIfAborted();return api('/api/projects/'+(state.projectOwner?.projectId?state.projectOwner.projectId+'/':'')+'publication-sites',{workspaceId:state.book.id,projectId:filter,search,cursor,limit:25},{adopt:false,signal:request.signal});};
   const result=await (unlock?access(run):run());if(!valid())return;
   if(result?.workspaceId!==state.book.id||!Array.isArray(result.items)||result.items.length>25||!Number.isSafeInteger(result.total)||result.total<0||!Number.isSafeInteger(result.offset)||result.offset<0||result.offset>result.total||result.items.length!==Math.min(25,result.total-result.offset)||result.items.some(item=>!item||!researchId(item.workspaceId)||item.projectId!==null&&!researchId(item.projectId)||item.labBookId!==null&&!researchId(item.labBookId)||item.siteId!==null&&!researchId(item.siteId)||item.key!==item.workspaceId+'/'+(item.siteId??'default')||typeof item.name!=='string'||typeof item.ownerLabel!=='string')||new Set(result.items.map(item=>item.key)).size!==result.items.length||![result.previousCursor,result.nextCursor].every(value=>value===null||typeof value==='string'&&!!value))throw Error('WEBSITE_DIRECTORY_RESPONSE');
   page=result;status='ready';
  }catch(error){if(!valid())return;page=null;status='error';}finally{if(valid()){controller=null;paint();}}
 }
 function view(projectId){filter=projectId;return '<section data-website-directory><div class="field"><label for="website-directory-search">'+esc(tr('directorySearch'))+'</label><input id="website-directory-search" type="search" data-website-directory-search maxlength="160" value="'+esc(search)+'"></div><p tabindex="-1" role="status" data-website-directory-status></p><div data-website-directory-items></div><div class="module-actions">'+['previous','next','retry'].map(direction=>'<button type="button" class="button" data-action="site-directory-'+direction+'" hidden>'+esc(tr('directory'+direction[0].toUpperCase()+direction.slice(1)))+'</button>').join('')+'</div></section>';}
 function bind(){if(!active()){clear();return;}const next=key();if(next!==identity){clear();identity=next;root().querySelector('[data-website-directory-search]').value='';void load();}else paint();}
 function input(element){if(!element.hasAttribute('data-website-directory-search')||!active())return false;stop();search=element.value;cursor=null;page=null;status='loading';paint();timer=setTimeout(()=>load(),180);return true;}
 async function action(element){
  const name=element.dataset.action;if(name==='site-owner-open'){const item=page?.items.find(item=>item.key===element.dataset.key);if(item&&status==='ready'){stop();await open(item);}return true;}
  if(!name?.startsWith('site-directory-'))return false;const direction=name.slice('site-directory-'.length);
  if(direction==='previous'||direction==='next'){if(status!=='ready'||!page?.[direction+'Cursor'])return true;cursor=page[direction+'Cursor'];}else if(direction!=='retry')return false;
  await load(direction==='retry');root()?.querySelector('[data-website-directory-status]')?.focus();return true;
 }
 return {view,bind,input,action,clear};
}
