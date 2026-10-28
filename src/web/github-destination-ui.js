import './i18n/catalogues/githubConnection.js';
import {t} from './i18n/index.js';
import {websiteContext} from './website-context.js';

export function githubDestinationUI({state,api,esc,field,select}){
 const text=(key,values)=>t('githubConnection',key,values);
 const key=()=>JSON.stringify([websiteContext(state),state.publishing?.account?.id,state.publishing?.connected,state.publishing?.temporaryToken]);
 let context=null,generation=0,owners=null,repositories=null,owner='',selectedRepository='',error='',busy=false;
 function reset(){context=key();generation++;owners=null;repositories=null;owner='';selectedRepository='';error='';busy=false;}
 function mount(){const node=document.getElementById('github-destination-browser');if(node)node.outerHTML=view();}
 function invalidate(){reset();mount();}
 function view(){
  if(context!==key())reset();
  const button=(action,label,disabled=false)=>`<button type="button" class="button" data-action="publish-destination-${action}" ${disabled?'disabled':''}>${esc(text(label))}</button>`;
  const pages=(kind,result)=>`<div class="inline-actions">${button(kind+'-previous','previousChoices',busy||result.page===1)}<span>${esc(text('choicePage',{page:result.page}))}</span>${button(kind+'-next','nextChoices',busy||!result.next)}</div>`;
  const choices=owners?[owners.account,...owners.items]:[];
  return `<section id="github-destination-browser"><h3>${esc(text('browseDestination'))}</h3>${button('browse',owners?'refreshChoices':'browseChoices',busy||!state.publishing?.connected)}${!state.publishing?.connected?`<p>${esc(text('connectToBrowse'))}</p>`:''}${busy?`<p role="status">${esc(text('loadingChoices'))}</p>`:''}${error?`<p role="alert">${esc(error)}</p>`:''}${owners?`${field(text('ownerChoice'),`<select id="github-destination-owner" ${busy?'disabled':''}><option value="">${esc(text('chooseOwner'))}</option>${choices.map(value=>`<option value="${esc(value.login)}" ${owner===value.login?'selected':''}>${esc(value.login)} (${esc(text(value.kind==='organization'?'organizationChoice':'accountChoice'))})</option>`).join('')}</select>`)}${pages('owners',owners)}${owners.source==='repositories'?`<p class="muted">${esc(text('repositoryOwners'))}</p>`:''}<p class="muted">${esc(text('organizationAccess'))} <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer">${esc(text('manage'))}</a></p><div class="inline-actions">${button('owner','useOwner',busy||!owner)}${button('repositories','showRepositories',busy||!owner)}</div>`:''}${repositories?`${field(text('repositoryChoice'),`<select id="github-destination-repository" ${busy?'disabled':''}><option value="">${esc(text('chooseRepository'))}</option>${repositories.items.map(value=>`<option value="${value.id}" ${selectedRepository===String(value.id)?'selected':''}>${esc(value.name)}${value.private?' ('+esc(text('privateRepository'))+')':''}</option>`).join('')}</select>`)}${!repositories.items.length?`<p>${esc(text('noRepositories'))}</p>`:''}${pages('repositories',repositories)}${button('use','useRepository',busy||!selectedRepository)}`:''}<p class="muted">${esc(text('manualDestination'))}</p></section>`;
 }
 async function fetchPage(kind,page){
  const selected=context,request=++generation,selectedOwner=owner;busy=true;error='';mount();
  try{
   const result=await api('/api/publishing/destinations',{kind,page,...(kind==='repositories'?{owner:selectedOwner}:{})},{adopt:false});
   if(selected!==key()||request!==generation)return;
   selectedRepository='';if(kind==='owners'){owners=result;repositories=null;const choices=[result.account,...result.items];if(!choices.some(item=>item.login===owner))owner='';}else repositories=result;
  }catch(failure){if(selected===key()&&request===generation)error=failure.message;}
  finally{if(selected===key()&&request===generation){busy=false;mount();}}
 }
 function input(element){
  if(element.id==='github-destination-repository'){selectedRepository=element.value;const use=document.querySelector('[data-action="publish-destination-use"]');if(use)use.disabled=busy||!selectedRepository;return true;}
  if(element.id!=='github-destination-owner')return false;
  owner=element.value;selectedRepository='';repositories=null;error='';mount();return true;
 }
 async function action(button){
  const action=button.dataset.action;if(!action.startsWith('publish-destination-'))return false;
  if(context!==key())reset();if(busy)return true;
  if(action==='publish-destination-browse')await fetchPage('owners',1);
  else if(action==='publish-destination-repositories')await fetchPage('repositories',1);
  else if(action==='publish-destination-owner'&&owner)select({owner});
  else if(action==='publish-destination-use'){
   const id=document.getElementById('github-destination-repository')?.value,item=repositories?.items.find(value=>String(value.id)===id);
   if(item)select({owner:item.owner,repository:item.name,branch:item.branch});
  }else{
   const match=/^publish-destination-(owners|repositories)-(previous|next)$/.exec(action);
   if(match){const value=match[1]==='owners'?owners:repositories,page=match[2]==='previous'?value?.page-1:value?.next;if(page>0)await fetchPage(match[1],page);}
  }
  return true;
 }
 return {view,action,input,invalidate};
}
