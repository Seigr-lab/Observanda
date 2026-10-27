import './i18n/catalogues/githubConnection.js';
import {t} from './i18n/index.js';

// Refresh only this panel: authorizing must never discard destination edits.
export function githubConnectionUI({state,api,esc,field,notify}){
 let snapshot=null,context=null,timer=null,request=0;
 const text=(key,values)=>t('githubConnection',key,values),call=(op,data={})=>api('/api/github-connection/'+op,data,{adopt:false});
 const active=()=>['waiting','saving'].includes(snapshot?.signIn?.state);
 function reset(){if(context!==state.storage?.contextId){context=state.storage?.contextId;snapshot=null;request++;clearTimeout(timer);}}
 function mount(){const panel=document.getElementById('github-connection');if(panel)panel.outerHTML=view();}
 function schedule(){clearTimeout(timer);const selected=context;timer=setTimeout(()=>{if(selected===state.storage?.contextId&&document.getElementById('github-connection'))refresh().catch(error=>notify(error.message,true));},750);}
 async function refresh(){reset();const selected=context,id=++request,result=await call('status');if(selected!==state.storage?.contextId||id!==request)return;
  snapshot=result;if(state.publishing){state.publishing.account=result.selected;state.publishing.connected=!!state.publishing.temporaryToken||result.connected;}
  mount();if(active())schedule();
 }
 function view(){reset();const value=snapshot,busy=active(),signIn=value?.signIn,selected=value?.selected,temporary=state.publishing?.temporaryToken;
  return `<section id="github-connection" class="panel"><h2>${esc(text('title'))}</h2><p class="muted">${esc(text('description'))}</p><p class="muted">${esc(text('privacy'))}</p><p class="muted">${esc(text('permissions'))}</p><p role="status">${esc(!value?text('loading'):temporary?text('temporary'):value.connected?text('connected',{login:selected.login}):text('disconnected'))}</p>${value?.error?`<p role="alert">${esc(t('errors',value.error))}</p>`:''}${signIn?.error&&signIn.state==='failed'?`<p role="alert">${esc(t('errors',signIn.error))}</p>`:''}${busy?`<p role="status">${esc(text(signIn.state))}</p><button class="button" data-action="github-cancel" ${signIn.state==='saving'?'disabled':''}>${esc(text('cancel'))}</button>`:`${value?.available===false?`<p>${esc(text('unavailable'))}</p>`:''}<button class="button primary" data-action="github-start" ${!value?.available?'disabled':''}>${esc(text(value?.connected?'another':selected?'reconnect':'signIn'))}</button>${value?.accounts.length?`<div class="inline-actions">${field(text('savedAccount'),`<select id="github-saved-account">${value.accounts.map(login=>`<option value="${esc(login)}" ${login.toLowerCase()===selected?.login.toLowerCase()?'selected':''}>${esc(login)}</option>`).join('')}</select>`)}<button class="button" data-action="github-choose">${esc(text('choose'))}</button></div>`:''}${selected?`<div class="inline-actions"><button class="button" data-action="github-disconnect">${esc(text('disconnect'))}</button></div><details><summary>${esc(text('forget'))}</summary><p>${esc(text('forgetHint'))}</p><button class="button" data-action="github-forget">${esc(text('forget'))}</button></details>`:''}`}
  <p><a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer">${esc(text('manage'))}</a></p><button class="button subtle" data-action="github-refresh">${esc(text('refresh'))}</button>
  <details><summary>${esc(text('advanced'))}</summary><p>${esc(text('tokenHint'))}</p><form id="publish-token-form">${field(text('token'),'<input type="password" name="token" autocomplete="off" required>')}<button class="button" type="submit" ${busy?'disabled':''}>${esc(text('connectToken'))}</button>${temporary?` <button class="button subtle" type="button" data-action="publish-disconnect">${esc(text('disconnectToken'))}</button>`:''}</form></details></section>`;
 }
 async function action(button){const name=button.dataset.action;if(!name.startsWith('github-'))return false;reset();const selected=context;button.disabled=true;
  try{
   if(name==='github-start')await call('start');
   else if(name==='github-cancel')await call('cancel');
   else if(name==='github-choose')await call('choose',{login:document.getElementById('github-saved-account').value});
   else if(name==='github-disconnect'||name==='github-forget')await call('disconnect',{forget:name==='github-forget'});
   else if(name!=='github-refresh')return false;
   if(selected!==state.storage?.contextId)return true;
   if(name!=='github-refresh'&&name!=='github-cancel')state.publishing.temporaryToken=false;
   await refresh();return true;
  }finally{button.disabled=false;}
 }
 return {view,refresh,action};
}
