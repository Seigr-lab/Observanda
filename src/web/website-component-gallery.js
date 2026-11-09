import {websiteFilesGallery} from './website-files-gallery.js';

// The component is expressed in the site's root coordinates. Pending preview
// images belong to the preview DOM; only their approved relative names are saved.
export function componentGallery({doc,host,source,apply,pin,t,esc,revise}){
 const panel=host.querySelector('[data-main-gallery]'),tools=panel.querySelector('[data-main-gallery-tools]');
 const draft=doc.implementation.createHTMLDocument();
 draft.body.innerHTML=source.value;
 const url=file=>new URL('/api/website-files/preview/'+pin.siteId+'/'+pin.expectedRevision+'/'+file,window.location.href).href;
 let css='';
 const notify=text=>{host.querySelector('[data-main-error]').textContent=text;};
 const gallery=websiteFilesGallery({t,esc,path:()=>'index.html',url,read:()=>draft,getCSS:()=>css,setCSS:value=>{css=value;},
  createTarget:()=>draft.body.firstElementChild?.matches('section:not([data-image-gallery]),article,aside,div:not([data-image-gallery])')?draft.body.firstElementChild:null,
  checkpoint:()=>{},notify,run:async task=>{
   if(apply.disabled)return;apply.disabled=true;tools.inert=true;
   try{await task();}finally{apply.disabled=false;tools.inert=false;}
  },
  update:()=>{
   source.value=draft.body.innerHTML;if(!host.open)return;doc.body.innerHTML=source.value;gallery.paint(doc);revise();
  },
  render:()=>{if(!host.open)return;tools.innerHTML=gallery.view();gallery.bind(tools.querySelector('.website-gallery-editor'));}
 });
 const setInput=e=>{if(gallery.input(e.target))e.stopPropagation();};
 tools.addEventListener('input',setInput);tools.addEventListener('change',setInput);
 tools.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(!action?.startsWith('website-files-gallery-'))return;
  event.preventDefault();event.stopPropagation();gallery.action(action.slice('website-files-gallery-'.length),event.target.closest('[data-action]'));
 });
 gallery.open();const found=draft.body.querySelector('[data-image-gallery]');
 panel.hidden=!found&&!draft.body.firstElementChild?.matches('section,article,aside,div');if(found)panel.open=true;
 tools.innerHTML=gallery.view();gallery.bind(tools.querySelector('.website-gallery-editor'));
 return {
  syncText(authored){
   draft.body.innerHTML=authored;
  },
  upload(data){
   const template=doc.createElement('template');template.innerHTML=data.html;
   return gallery.body(data,'index.html',template.content);
  },
  dispose:()=>gallery.reset()
 };
}
