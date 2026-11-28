import {t} from './i18n/index.js';
import {authorizeBrowser} from './browser-session.js';
import {keepSessionAlive,reconnect,reconnectUrl} from './session-keepalive.js';

// A tab-bound nonce permits retry of a lost bootstrap response without minting
// another session. The launch token alone is one-use; both expire on the server.
export async function startApplication({api,load,show,esc,location=window.location,history=window.history}){
 try{
  const token=location.hash.slice(1);
  if(/^[a-f0-9]{64}$/.test(token)){
   const slot='observanda.launch.'+token;let binding=sessionStorage.getItem(slot);
   if(!/^[a-f0-9]{64}$/.test(binding)){binding=Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join('');sessionStorage.setItem(slot,binding);}
   const result=await api('/api/session',{token,binding});await authorizeBrowser(result.session);sessionStorage.removeItem(slot);
   if(location.hash==='#'+token)history.replaceState(history.state,'',location.pathname+location.search);
  }else await authorizeBrowser();
  await load();keepSessionAlive({location});
 }catch(error){
  const authorization=error?.code==='AUTH',message=key=>esc(t('startup',key));
  // A window whose session has ended asks once to be reconnected before showing this page.
  if(authorization&&reconnect(location))return;
  const detail=!authorization&&error?.code&&typeof error.message==='string'?'<p role="alert">'+esc(error.message)+'</p>':'';
  const researchUnavailable=typeof error?.code==='string'&&/^(?:DATABASE(?:_|$)|CATALOGUE_)/.test(error.code);
  show('<main id="main" class="loading"><h1 tabindex="-1">'+message(authorization?'unauthorized':'connectionFailed')+'</h1><p>'+message(authorization?'authorizationMessage':'connectionMessage')+'</p>'+detail+'<button type="button" class="button primary" id="startup-reload">'+message(authorization?'reconnect':'reload')+'</button>'+(researchUnavailable?'<button type="button" class="button" id="startup-website">'+esc(t('websiteSites','editor'))+'</button>':'')+'</main>');
  document.querySelector('#main h1')?.focus();document.getElementById('startup-reload').addEventListener('click',()=>{if(authorization)location.assign(reconnectUrl(location));else location.reload();});
  document.getElementById('startup-website')?.addEventListener('click',()=>{const url=new URL(location.href);url.searchParams.set('view','website');if(!/^#[a-f0-9]{64}$/.test(url.hash))url.hash='#/website';location.assign(url.href);});
 }
}
