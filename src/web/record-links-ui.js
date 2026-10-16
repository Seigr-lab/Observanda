import {parseResearchReference} from './research-reference.js';
import {safeRichLink} from './rich-text-model.js';
import {t} from './i18n/index.js';

const text=(key,args)=>t('recordLinks',key,args);

export function linkDestination(href,book){
 const target=parseResearchReference(href);
 if(!target)return href;
 const same=target.workspaceId===book?.id;
 const item=same?(target.kind==='workspace'?book:book?.[{record:'entries',notebook:'notebooks',project:'projects'}[target.kind]]?.find(v=>v.id===target.id)):null;
 return [text(target.kind),item?.title||target.id,!same?text('anotherWorkspace'):null,target.revision?text('revision',{revision:target.revision.slice(0,12)}):text('current'),target.selector?text('section',{kind:target.selector.kind,id:target.selector.id}):null].filter(Boolean).join(' · ');
}

// An editor link is selectable text. Its destination and explicit Open action
// live in the existing toolbar; inspecting it never navigates or edits content.
export function editorLinkInspector({host,book=()=>null,open}){
 const doc=host.ownerDocument,controller=new AbortController(),options={signal:controller.signal};
 const panel=doc.createElement('div');panel.className='record-link-inspector';panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label',text('destination'));
 const label=doc.createElement('strong'),address=doc.createElement('code'),button=doc.createElement('button');
 button.type='button';button.className='button';button.textContent=text('open');panel.append(label,address,button);host.querySelector('.document-tools').append(panel);
 let href=null;
 function show(anchor){
  href=anchor?.getAttribute('href')??null;
  panel.hidden=!href||!safeRichLink(href);if(panel.hidden)return;
  label.textContent=linkDestination(href,book());address.textContent=href;
 }
 function selection(){
  const node=doc.getSelection()?.anchorNode,el=node?.nodeType===1?node:node?.parentElement;
  if(!el||!host.contains(el)||panel.contains(el))return;
  show(el.closest('.document-content a[href]'));
 }
 host.addEventListener('click',event=>{const anchor=event.target.closest('.document-content a[href]');if(anchor)show(anchor);},options);
 doc.addEventListener('selectionchange',selection,options);
 button.addEventListener('click',()=>{
  if(!href||!safeRichLink(href))return;
  if(href.startsWith('#')){const target=doc.getElementById(href.slice(1));if(target){target.setAttribute('tabindex','-1');target.focus();target.scrollIntoView({block:'start'});}return;}
  open(href);
 },options);
 return {destroy(){controller.abort();panel.remove();}};
}

// Destinations remain inspectable with a keyboard and on touch screens. This is
// presentation only: titles/tooltips never enter saved rich text or exports.
export function decorateRecordLinks(root,book){
 for(const surface of root.querySelectorAll('.record-reader,.lab-book-reading-entry')){
  const links=[...surface.querySelectorAll('a[href]')].filter(a=>!a.closest('.record-link-listing'));
  for(const a of links)a.title=linkDestination(a.getAttribute('href'),book);
  if(surface.querySelector(':scope > .record-link-listing')||!links.length)continue;
  const doc=surface.ownerDocument,details=doc.createElement('details'),summary=doc.createElement('summary'),list=doc.createElement('ul'),seen=new Set();
  details.className='record-link-listing';summary.textContent=text('list');details.append(summary,list);
  for(const a of links){
   const href=a.getAttribute('href'),key=JSON.stringify([a.textContent,href]);if(seen.has(key)||!safeRichLink(href))continue;seen.add(key);
   const row=doc.createElement('li'),link=doc.createElement('a'),destination=doc.createElement('span'),address=doc.createElement('code');
   link.href=href;link.textContent=a.textContent||text('open');link.title=a.title;
   if(/^https?:/.test(href)){link.target='_blank';link.rel='noopener noreferrer';}
   destination.textContent=linkDestination(href,book);address.textContent=href;row.append(link,destination,address);list.append(row);
  }
  if(list.childElementCount)surface.append(details);
 }
}
