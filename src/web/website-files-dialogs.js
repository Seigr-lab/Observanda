import {savedPageLink} from './website-files-navigation.js';
import {checkAuthoredPage} from './website-author-checks.js';
import {websiteVisualSections} from './website-files-visual.js';

function dialog(title,build){
 const modal=document.createElement('dialog');modal.className='website-author-dialog';
 const heading=document.createElement('h2');heading.textContent=title;heading.id='website-dialog-'+crypto.randomUUID();modal.setAttribute('aria-labelledby',heading.id);modal.append(heading);
 build(modal);document.body.append(modal);modal.addEventListener('close',()=>modal.remove(),{once:true});modal.showModal();return modal;
}
function control(parent,label,node){const field=document.createElement('label');field.append(label,node);parent.append(field);return node;}
function action(parent,text,click){const button=document.createElement('button');button.className='button';button.type='button';button.textContent=text;button.onclick=click;parent.append(button);return button;}
export function showPageChecks({doc,path,directory,pages,t,select}){
 const issues=checkAuthoredPage(doc,path,directory,pages),sections=websiteVisualSections(doc);
 dialog(t('checkPage'),modal=>{
  const hint=document.createElement('p');hint.textContent=t(issues.length?'reviewDetails':'noIssues');modal.append(hint);
  const list=document.createElement('ul');modal.append(list);
  for(const {key,node,detail} of issues){
   const item=document.createElement('li'),message=t(key)+(detail?' — '+detail:'');list.append(item);
   const owner=sections.findLast(s=>s.node.contains(node));
   if(owner)action(item,message,()=>{modal.close();select(owner.path);});else item.textContent=message;
  }
  action(modal,t('cancel'),()=>modal.close());
 });
}
export const buttonCSS='\n.website-button{display:inline-flex;align-items:center;justify-content:center;padding:.65em 1.15em;border:2px solid currentColor;border-radius:.35em;text-decoration:none;font-weight:600}.website-button:hover{text-decoration:underline}.website-button:focus-visible{outline:3px solid currentColor;outline-offset:3px}\n';
export function editActionLink({doc,at,t,path,directory,pages,apply}){
 const scope=at&&!at.closest('[data-observanda-source],[data-observanda-link]')?at:null;
 const links=scope?[...(scope.matches('a[href]')?[scope]:scope.querySelectorAll('a[href]'))].filter(a=>!a.closest('[data-observanda-source],[data-observanda-link]')&&!a.querySelector('[data-observanda-source],[data-observanda-link]')):[];
 dialog(t('actionLink'),modal=>{
  const form=document.createElement('form');modal.append(form);
  const choose=document.createElement('select');choose.add(new Option(t('addBlock'),'-1'));
  links.forEach((link,i)=>choose.add(new Option(link.textContent.trim()||link.getAttribute('href'),String(i))));
  if(links.length){control(form,t('actionLink'),choose);choose.value='0';}
  const label=control(form,t('linkLabel'),document.createElement('input'));label.required=true;
  const target=control(form,t('linkTarget'),document.createElement('input'));target.required=true;
  const blank=control(form,t('newWindow'),document.createElement('input'));blank.type='checkbox';
  function display(){const link=links[Number(choose.value)];label.value=link?.textContent.trim()??'';target.value=link?.getAttribute('href')??'';blank.checked=link?.target==='_blank';}
  choose.onchange=display;display();target.oninput=()=>target.setCustomValidity('');
  const submit=document.createElement('button');submit.type='submit';submit.className='button primary';submit.textContent=t('applyButton');form.append(submit);action(form,t('cancel'),()=>modal.close());
  form.onsubmit=e=>{
   e.preventDefault();const href=target.value.trim(),value=label.value.trim();let url;
   try{url=new URL(href,new URL(path,directory));}catch{}
   const local=href.startsWith('#')||savedPageLink(href,new URL(path,directory),directory,pages);
   if(!value||!url||!local&&(!/^(https?:\/\/|mailto:)/i.test(href)||url.username||url.password||url.origin===directory.origin||/^(localhost|127\.|\[::1\])/.test(url.hostname)||/^\/api(?:\/|$)/i.test(url.pathname))){target.setCustomValidity(t('badLink'));target.reportValidity();return;}
   const link=links[Number(choose.value)]??doc.createElement('a');
   if(!link.parentElement){const box=doc.createElement('p');box.append(link);if(scope&&scope.parentElement&&!scope.closest('header,nav,footer'))scope.after(box);else (doc.querySelector('main:not([hidden])')??doc.body).append(box);}
   if(link.textContent.trim()!==value)link.textContent=value;
   link.classList.add('website-button');link.setAttribute('href',href);
   if(blank.checked){link.target='_blank';link.relList.add('noopener','noreferrer');}else link.removeAttribute('target');
   modal.close();apply(doc);
  };
 });
}
