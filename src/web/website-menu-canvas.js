import {loadWebsiteCanvas,websiteHTML} from './website-html-document.js';
import {menuCSS} from './website-menu-theme.js';
import {validWebsiteLink} from './website-files-text-link.js';

const protectedArea='[data-observanda-source],[data-observanda-part],[data-website-instance],[data-website-region],[data-website-feed],[data-website-source-gallery]';
function primaryMenu(doc){
 const navs=[...doc.querySelectorAll('nav:not([data-website-menu-id])')].filter(n=>!n.closest(protectedArea));
 const candidates=[...navs.filter(n=>n.hasAttribute('data-website-menu')),...navs.filter(n=>n.getAttribute('aria-label')==='Website'||n.parentElement?.classList.contains('site-top')),
  ...navs.filter(n=>n.querySelector(':scope > .site-menu')),...navs.filter(n=>n.parentElement?.matches('header,body')&&!n.matches('.book-page-navigation,.page-contents,.section-index'))];
 return candidates.find(n=>!n.querySelector('[data-website-instance],[data-observanda-source]:not(a)')&&
  (n.querySelector(':scope > ul,:scope > ol')||Array.from(n.children).every(c=>c.matches('a'))));
}
export function menuCanvasTarget(node){
 const nav=node?.closest?.('nav');if(!nav||nav.closest(protectedArea))return null;
 return nav.hasAttribute('data-website-menu-id')||primaryMenu(nav.ownerDocument)===nav?nav:null;
}

// Mount just the saved menu region and its actual styles. The preview never
// mounts a gallery, feed, or scientific page beneath the navigation.
export function mountMenuPreview(frame,opened,baseURL,getDraft,select){
 const url=baseURL(opened.path);let current=null;
 function sizePreview(){
  if(!current||!frame.isConnected)return;
  const {nav}=current;
  let bottom=nav.getBoundingClientRect().bottom;
  for(const ul of nav.querySelectorAll('details[open]>ul'))bottom=Math.max(bottom,ul.getBoundingClientRect().bottom);
  frame.style.height=Math.min(Math.max(88,Math.ceil(bottom+14)),Math.max(160,frame.ownerDocument.documentElement.clientHeight*.55))+'px';
 }
 function paint(edited){
  if(!current)return;
  const {doc,nav}=current,{items,name}=getDraft(),expanded=new Set([...nav.querySelectorAll('details[open]')].map(n=>n.dataset.uid));
  function setLink(a,item){
   a.textContent=item.label;a.dataset.uid=item.uid;
   const base=baseURL(item.href.startsWith('#')?opened.path:'index.html');
   if(!item.blocked&&validWebsiteLink(item.href,base))a.href=new URL(item.href,base).href;else a.removeAttribute('href');
  }
  if(edited){
   const a=nav.querySelector('a[data-uid="'+edited.uid+'"]');
   if(a){setLink(a,edited);a.nextElementSibling?.querySelector('summary')?.setAttribute('aria-label',edited.label);}
   return;
  }
  function list(rows){
   const ul=doc.createElement('ul');ul.className='site-menu';
   for(const item of rows){
    const li=doc.createElement('li'),a=doc.createElement('a');setLink(a,item);li.append(a);
    if(item.children.length){
     const details=doc.createElement('details'),summary=doc.createElement('summary');details.className='site-submenu';details.dataset.uid=item.uid;details.open=expanded.has(item.uid);summary.textContent='▾';summary.setAttribute('aria-label',item.label);details.append(summary);
     const fill=()=>{if(details.open&&!summary.nextElementSibling)details.append(list(item.children));else if(!details.open)summary.nextElementSibling?.remove();};
     details.ontoggle=()=>{fill();sizePreview();};fill();li.append(details);
    }
    ul.append(li);
   }
   return ul;
  }
  nav.setAttribute('aria-label',name);nav.replaceChildren(list(items));sizePreview();
 }
 frame.onload=()=>{
  if(!frame.isConnected)return;
  const source=websiteHTML(opened.html),draft=getDraft(),original=draft.id?[...source.querySelectorAll('nav[data-website-menu-id]')].find(nav=>nav.dataset.websiteMenuId===draft.id):primaryMenu(source);
  const nav=original?.cloneNode(false)??source.createElement('nav'),body=source.body,ancestry=[];
  const area=!draft.id||original?.dataset.websiteMenuPosition===draft.position?original?.parentElement:
   [...body.querySelectorAll(draft.position==='header'?'header,.site-top':'footer')].find(n=>!n.closest('main,article,section,aside,nav,[hidden],'+protectedArea));
  for(let p=area;p&&p!==body;p=p.parentElement)ancestry.unshift(p.cloneNode(false));
  if(!area)ancestry.push(source.createElement(draft.position));
  let parent=body;body.replaceChildren();for(const p of ancestry){parent.append(p);parent=p;}parent.append(nav);
  nav.setAttribute('data-website-menu','');
  const style=source.createElement('style');style.textContent=menuCSS;source.head.prepend(style);
  const doc=frame.contentDocument;if(!doc)return;
  loadWebsiteCanvas(doc,source.documentElement.outerHTML,opened.css,baseURL(opened.site.cssPath));
  current={doc,nav:doc.querySelector('nav')};paint();
  new ResizeObserver(sizePreview).observe(current.nav);
  doc.addEventListener('click',event=>{const a=event.target.closest('a');if(a){event.preventDefault();select(a.dataset.uid);}});
  doc.addEventListener('auxclick',event=>event.preventDefault());
 };
 frame.src=url+'?canvas=1';return paint;
}
