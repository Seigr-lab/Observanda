import {language,t,prepareNamespaces} from '../i18n/index.js';
import {guideLoader,guideWithMessages,guideMessageNamespaces} from './model.js';
import {ux} from '../experience-ui.js';

// A separate modal keeps the current editor, its input and its owner mounted.
export function contextualHelp({esc}){
 const dialog=document.createElement('dialog'),load=guideLoader();
 dialog.className='context-help';dialog.setAttribute('aria-label',ux('contextHelp'));document.body.append(dialog);
 let controller=null,origin=null;
 function close(){controller?.abort();controller=null;dialog.close();dialog.innerHTML='';if(origin?.isConnected)origin.focus({preventScroll:true});origin=null;}
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('click',event=>{if(event.target.closest('[data-context-help-close]'))close();});
 async function open(topic,source,sectionIds=null){
  controller?.abort();const request=controller=new AbortController();origin=source;dialog.setAttribute('aria-label',ux('contextHelp'));dialog.lang=language();
  const frame=content=>'<div class="context-help-heading"><h2>'+esc(ux('contextHelp'))+'</h2><button class="button" data-context-help-close>'+esc(t('recordWriting','close'))+'</button></div>'+content;
  dialog.innerHTML=frame('<p role="status">'+esc(t('help','loading'))+'</p>');dialog.showModal();
  try{
   const guide=await load(language(),{signal:request.signal});
   const selected=guide.topics.find(value=>value.id===topic)??guide.topics.find(value=>value.id==='getting-started');
   const requested={topics:selected?[{...selected,sections:selected.sections.filter(section=>!sectionIds||sectionIds.includes(section.id))}]:[]};
   await prepareNamespaces(guideMessageNamespaces(requested));
   if(controller!==request)return;
   const [article]=guideWithMessages(requested,t).topics;
   const body=article?'<article lang="'+esc(article.language??language())+'"><h3>'+esc(article.title)+'</h3>'+article.sections.map(section=>'<section><h4>'+esc(section.title)+'</h4>'+section.paragraphs.map(text=>'<p>'+esc(text)+'</p>').join('')+'</section>').join('')+'</article>':'<p>'+esc(t('help','missing'))+'</p>';
   // Keep the close control mounted so asynchronous loading does not lose focus.
   dialog.querySelector('[role=status]').outerHTML=body;
  }catch(error){if(controller===request&&error.name!=='AbortError')dialog.querySelector('[role=status]').textContent=t('help','failed');}
 }
 return {open,close};
}
