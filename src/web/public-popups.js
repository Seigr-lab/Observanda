// Self-contained progressive enhancement for static editions. No service, wallet
// integration or tracking: links remain links and copying writes only authored text.
export function enhancePublicPopups(doc){
 if(doc.documentElement.hasAttribute('data-popups-ready'))return;
 doc.documentElement.setAttribute('data-popups-ready','');
 const popups=[];
 for(const details of doc.querySelectorAll('[data-public-popup]')){
  const trigger=details.querySelector(':scope>summary'),body=details.querySelector(':scope>.popup-body'),dialog=doc.createElement('dialog');
  if(!trigger||!body||typeof dialog.showModal!=='function')continue;
  dialog.className='public-popup';dialog.setAttribute('aria-labelledby',body.querySelector('h2').id);
  const bar=body.querySelector(':scope>.popup-controls'),close=bar?.querySelector('button');if(!close)continue;
  details.after(dialog);
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
  const state={details,body,dialog,trigger,open(focus=true){
   if(dialog.open)return;
   details.open=false;bar.hidden=false;dialog.append(body);dialog.showModal();trigger.setAttribute('aria-expanded','true');if(focus)close.focus();
  }};
  popups.push(state);
  trigger.addEventListener('click',event=>{event.preventDefault();state.open();});
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('keydown',event=>{
   if(event.key!=='Tab'||event.target.closest('dialog')!==dialog)return;
   const stops=[...dialog.querySelectorAll('a[href],button,input,textarea,select,summary,[tabindex]')].filter(el=>el.closest('dialog')===dialog&&el.tabIndex>=0&&!el.disabled&&!el.closest('[inert]')&&el.getClientRects().length);
   const first=stops[0],last=stops.at(-1);
   if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
  });
  dialog.addEventListener('close',()=>{
   // A reopened dialog can receive the previous asynchronous close event.
   if(dialog.open)return;
   for(const child of popups)if(child!==state&&body.contains(child.dialog)&&child.dialog.open)child.dialog.close();
   details.append(body);details.open=false;trigger.setAttribute('aria-expanded','false');if(trigger.getClientRects().length)trigger.focus({preventScroll:true});
  });
 }
 for(const block of doc.querySelectorAll('.public-copy')){
  const field=block.querySelector('textarea'),button=block.querySelector('button'),status=block.querySelector('[role=status]');if(!field||!button||!status)continue;
  let value;try{value=JSON.parse(block.dataset.copyValue);}catch{continue;}if(typeof value!=='string')continue;
  field.value=value;button.hidden=false;let sequence=0,busy=false;
  button.addEventListener('click',async()=>{
   if(busy)return;
   const pending=++sequence;status.textContent='';busy=true;button.setAttribute('aria-disabled','true');button.setAttribute('aria-busy','true');
   try{
    const clipboard=doc.defaultView?.navigator.clipboard;if(typeof clipboard?.writeText!=='function')throw new Error();
    await clipboard.writeText(value);
    if(pending===sequence&&block.isConnected)status.textContent=block.dataset.copied;
   }catch{
    if(pending===sequence&&block.isConnected){status.textContent=block.dataset.fallback;if(field.getClientRects().length){field.focus();field.select();}}
   }finally{if(pending===sequence){busy=false;button.removeAttribute('aria-disabled');button.removeAttribute('aria-busy');}}
  });
 }
 function followFragment(){
  let id;try{id=decodeURIComponent(doc.defaultView.location.hash.slice(1));}catch{return;}
  const target=id&&doc.getElementById(id);if(!target)return;
  for(const state of popups){if(state.body.contains(target))state.open(false);else if(state.dialog.open)state.dialog.close();}
  if(popups.some(state=>state.body.contains(target)))target.scrollIntoView({block:'nearest'});
 }
 doc.defaultView.addEventListener('hashchange',followFragment);followFragment();
 // Print the complete fallback content even if the visitor has a popup open.
 doc.defaultView.addEventListener('beforeprint',()=>{for(const state of popups)if(state.dialog.open){state.dialog.close();state.details.append(state.body);}});
}
