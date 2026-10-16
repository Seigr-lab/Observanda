import {t} from './i18n/index.js';

// Keep the launch capability until the server acknowledges the connection.
// No capability is persisted in local storage or diagnostics. Retrying a lost
// response can safely use the same launch link against the existing service.
export async function startApplication({api,load,show,esc,location=window.location,history=window.history}){
 try{
  const token=location.hash.slice(1);
  if(/^[a-f0-9]{64}$/.test(token)){
   await api('/api/session',{token});
   if(location.hash==='#'+token)history.replaceState(history.state,'',location.pathname+location.search);
  }
  await load();
 }catch(error){
  const authorization=error?.code==='AUTH',message=key=>esc(t('startup',key));
  const detail=error?.code&&typeof error.message==='string'?'<p role="alert">'+esc(error.message)+'</p>':'';
  show('<main id="main" class="loading"><h1 tabindex="-1">'+message(authorization?'unauthorized':'connectionFailed')+'</h1><p>'+message(authorization?'authorizationMessage':'connectionMessage')+'</p>'+detail+'<button type="button" class="button primary" id="startup-reload">'+message('reload')+'</button></main>');
  document.querySelector('#main h1')?.focus();document.getElementById('startup-reload').addEventListener('click',()=>location.reload());
 }
}
