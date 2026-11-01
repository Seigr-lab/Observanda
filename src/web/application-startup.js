import {t} from './i18n/index.js';

// A tab-bound nonce permits retry of a lost bootstrap response without minting
// another session. The launch token alone is one-use; both expire on the server.
export async function startApplication({api,load,show,esc,location=window.location,history=window.history}){
 try{
  const token=location.hash.slice(1);
  if(/^[a-f0-9]{64}$/.test(token)){
   const slot='observanda.launch.'+token;let binding=sessionStorage.getItem(slot);
   if(!/^[a-f0-9]{64}$/.test(binding)){binding=Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join('');sessionStorage.setItem(slot,binding);}
   await api('/api/session',{token,binding});sessionStorage.removeItem(slot);
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
