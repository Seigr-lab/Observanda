import './i18n/catalogues/websiteAuthoring.js';
import {t} from './i18n/index.js';
import {websiteContext} from './website-context.js';
import {githubConnectionUI} from './github-connection-ui.js';
import {serverLoginsUI} from './server-logins-ui.js';
import {publicationText} from './publication-review.js';

// Preferences > Integrations: the workspace's GitHub connection and server
// logins. Each website chooses one of them in its own publishing destination.
export function integrationsUI({state,api,esc,field,option,render,notify}){
 const msg=key=>t('websiteAuthoring',key);
 const github=githubConnectionUI({state,api,esc,field,notify});
 const servers=serverLoginsUI({api,esc,field,option,notify});
 async function load(){state.publishing=await api('/api/publishing');await Promise.all([github.refresh(),servers.refresh()]);}
 function view(){
  if(!state.publishing)return '<p>'+esc(msg('pubLoading'))+'</p>';
  return '<div class="settings-grid">'+github.view()+servers.view()+'</div>';
 }
 async function action(button){
  if(button.dataset.action==='publish-disconnect'){await api('/api/publishing/disconnect',{});await load();render();return true;}
  return await servers.action(button)||await github.action(button);
 }
 // A temporary access token connects GitHub for this session only.
 async function submit(form,data){
  if(await servers.submit(form))return true;
  if(form.id!=='publish-token-form')return false;
  const token=data.get('token'),context=websiteContext(state);form.querySelector('[name=token]').value='';
  const result=await api('/api/publishing/connect',{token});if(context!==websiteContext(state))return true;
  state.publishing.connected=result.connected;state.publishing.temporaryToken=true;notify(publicationText('connectedNotice'));render();return true;
 }
 return {view,load,action,submit,input:element=>servers.input(element),discardServerLogin:()=>servers.discard()};
}
