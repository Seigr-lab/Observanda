import './i18n/catalogues/websiteContent.js';
import {publicationSourceRevision} from './publication-source-context.js';
import {websiteSnapshot} from './website-context.js';
import {ownedAssetURL,projectApiRoute} from './project-context.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('websiteMedia',key,args);
export function websiteResearchMedia({state,research,esc,field,showDialog,notify,query=({signal,...data})=>research.query('media',data,{signal})}){
 let session=null;
 const identity=()=>JSON.stringify([websiteSnapshot(state),state.book?.id,state.etag,publicationSourceRevision(state)]);
 function close(){const s=session;session=null;s?.controller?.abort();clearTimeout(s?.timer);s?.unbind();if(s?.dialog.open)s.dialog.close();document.querySelector(s?.focus??'#website-preview-page')?.focus({preventScroll:true});}
 const valid=s=>s===session&&s.identity===identity()&&state.page==='website'&&s.dialog.open&&!state.access?.locked&&!state.storageUnavailable;
 function open({focus='#website-preview-page',choose}){
  close();showDialog(`<h2 id="dialog-title">${esc(text('chooseResearch'))}</h2><div data-research-media-picker>${field(text('search'),'<input type="search" maxlength="512" data-research-media-search>')}<div data-research-media-results></div><div class="dialog-actions"><button type="button" class="button" data-research-media-cancel>${esc(text('cancel'))}</button></div></div>`);
  const root=document.querySelector('[data-research-media-picker]'),dialog=root.closest('dialog'),s=session={root,dialog,focus,choose,identity:identity(),search:'',page:null,controller:null,version:0};
  const button=(key,disabled=false)=>`<button type="button" class="button" data-research-media-page="${key}" ${disabled?'disabled':''}>${esc(text(key))}</button>`;
  async function load(cursor=null){
   s.controller?.abort();s.controller=new AbortController();const {signal}=s.controller,version=++s.version;
   const host=root.querySelector('[data-research-media-results]');host.innerHTML=`<p role="status">${esc(t('websiteContent','loading'))}</p>`;
   try{const page=await query({search:s.search,cursor,signal});if(!valid(s)||version!==s.version)return;
    if(!Array.isArray(page.items)||page.items.length>12)throw Error(t('websiteContent','invalid'));s.page=page;
    host.innerHTML=`<ul class="website-media-results">${page.items.map(item=>`<li><button type="button" class="button" data-research-media-key="${esc(item.key)}">${item.asset.kind==='image'?`<img src="${esc((item.owner?projectApiRoute('/api/media/'+item.sourceAttachmentId,item.owner):ownedAssetURL(state,'/api/media/'+item.asset.id)))}" alt="" loading="lazy">`:''}<span>${esc(item.label)}</span></button></li>`).join('')}</ul><p role="status">${esc(page.total?text('range',{first:page.offset+1,last:page.offset+page.items.length,total:page.total}):page.items.length?text('matching'):text('empty'))}</p><div class="inline-actions">${button('previous',!page.previousCursor)}${button('next',!page.nextCursor)}</div>`;
   }catch(reason){if(!valid(s)||signal.aborted)return;host.innerHTML=`<p role="alert">${esc(reason.message??t('websiteContent','loadFailed'))}</p><button class="button" data-research-media-page="retry">${esc(t('websiteContent','retry'))}</button>`;}
  }
  const click=async event=>{const control=event.target.closest('[data-research-media-key],[data-research-media-page],[data-research-media-cancel]');if(!control||!root.contains(control))return;event.preventDefault();event.stopPropagation();
   if(control.hasAttribute('data-research-media-cancel')){close();return;}if(!valid(s))return;
   if(control.dataset.researchMediaKey){const item=s.page?.items.find(i=>i.key===control.dataset.researchMediaKey);if(item){close();try{await choose(item);}catch(error){notify(error.message,true);}}return;}
   const key=control.dataset.researchMediaPage;void load(key==='retry'?null:s.page?.[key+'Cursor']);
  };
  const input=event=>{if(!event.target.hasAttribute('data-research-media-search'))return;event.stopPropagation();s.search=event.target.value;s.controller?.abort();s.version++;clearTimeout(s.timer);s.timer=setTimeout(()=>void load(),180);};
  const cancel=event=>{event.preventDefault();event.stopImmediatePropagation();close();};
  const closed=()=>{if(session===s&&!dialog.open)close();};
  root.addEventListener('click',click);root.addEventListener('input',input);dialog.addEventListener('cancel',cancel,true);dialog.addEventListener('close',closed);
  s.unbind=()=>{root.removeEventListener('click',click);root.removeEventListener('input',input);dialog.removeEventListener('cancel',cancel,true);dialog.removeEventListener('close',closed);};void load();root.querySelector('input').focus();
 }
 return {open,sync(){if(session&&!valid(session))close();}};
}
