import {browserSession} from './session-store.js';
import fallback from './locales/en/startup.json' with {type:'json'};

const approved=new WeakSet(),pending=new WeakSet(),notices=new WeakMap();
async function downloadMessage(code){
 const language=/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?$/.test(document.documentElement.lang)?document.documentElement.lang:'en';let messages=fallback;
 if(language!=='en')try{const response=await fetch('/locales/'+language+'/startup.json');if(response.ok)messages=await response.json();}catch{}
 if(typeof code==='string'&&/^[A-Z_]+$/.test(code))try{const response=await fetch('/locales/'+language+'/errors.json');if(response.ok){const errors=await response.json();if(typeof errors[code]==='string')return errors[code];}}catch{}
 return messages.downloadFailed??fallback.downloadFailed;
}
export async function downloadResource(url,name=''){
  const target=new URL(url,location.href);if(target.origin!==location.origin||!/^\/(?:api|preview|appearance-preview)\//.test(target.pathname))throw Error('Invalid download target.');
  const session=await browserSession(),response=await fetch('/api/session/download',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Session':session},body:JSON.stringify({url:target.pathname+target.search})}),result=await response.json();
  if(!response.ok)throw {code:result.code,message:await downloadMessage(result.code)};
  const destination=new URL(result.url,location.href);if(destination.origin!==location.origin||destination.pathname!==target.pathname)throw Error('Invalid download response.');
  const transfer=document.createElement('a');transfer.href=destination.href;transfer.download=name;approved.add(transfer);document.body.append(transfer);transfer.click();transfer.remove();
}
if(typeof document!=='undefined')document.addEventListener('click',event=>{
 const link=event.target?.closest?.('a[download]');if(!link||approved.has(link)||event.defaultPrevented)return;
 const target=new URL(link.href,location.href);if(target.origin!==location.origin||!/^\/(?:api|preview|appearance-preview)\//.test(target.pathname))return;
 event.preventDefault();
 if(pending.has(link))return;pending.add(link);notices.get(link)?.remove();
 void downloadResource(link.href,link.download).catch(async error=>{const notice=document.createElement('span');notice.setAttribute('role','alert');notice.textContent=await downloadMessage(error.code);notices.set(link,notice);link.after(notice);}).finally(()=>pending.delete(link));
},true);
