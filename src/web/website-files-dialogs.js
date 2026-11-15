import {savedPageLink} from './website-files-navigation.js';

function dialog(title,build){
 const modal=document.createElement('dialog');modal.className='website-author-dialog';
 const heading=document.createElement('h2');heading.textContent=title;heading.id='website-dialog-'+crypto.randomUUID();modal.setAttribute('aria-labelledby',heading.id);modal.append(heading);
 build(modal);document.body.append(modal);modal.addEventListener('close',()=>modal.remove(),{once:true});modal.showModal();return modal;
}
function control(parent,label,node){const field=document.createElement('label');field.append(label,node);parent.append(field);return node;}
function action(parent,text,click){const button=document.createElement('button');button.className='button';button.type='button';button.textContent=text;button.onclick=click;parent.append(button);return button;}
// A Logos block shows the logos Branding gives one scope. Automatic follows each
// page: the record it presents, then its lab book and project, then the website.
export function editLogos({doc,at,t,choices,apply}){
 const current=at?.closest?.('[data-observanda-logos]')??null;
 dialog(t('logosTitle'),modal=>{
  const form=document.createElement('form');modal.append(form);
  const help=document.createElement('p');help.className='hint';help.textContent=t('logosHelp');form.append(help);
  const scope=control(form,t('logosScope'),document.createElement('select'));
  for(const [value,label] of choices)scope.add(new Option(label,value));
  const saved=current?.getAttribute('data-observanda-logos');scope.value=choices.some(([value])=>value===saved)?saved:'auto';
  const submit=document.createElement('button');submit.type='submit';submit.className='button primary';submit.textContent=t('logosApply');form.append(submit);action(form,t('cancel'),()=>modal.close());
  form.onsubmit=e=>{
   e.preventDefault();let node=current;
   if(!node){
    node=doc.createElement('div');node.className='site-logos';node.dataset.sectionId='ow-section-'+crypto.randomUUID();
    const main=doc.querySelector('main:not([hidden])')??doc.body;if(at&&at!==main&&main.contains(at))at.after(node);else main.append(node);
   }
   node.setAttribute('data-observanda-logos',scope.value);modal.close();apply(doc);
  };
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
