import {savedPageLink} from './website-files-navigation.js';

export function checkAuthoredPage(doc,path,directory,pages){
 const issues=[],pageURL=new URL(path,directory),ids=new Set();
 const add=(key,node,detail='')=>issues.push({key,node,detail:detail.slice(0,100)});
 if(!doc.title.trim())add('missingTitle',doc.documentElement);
 if(!doc.documentElement.lang.trim())add('missingLang',doc.documentElement);
 let level=0;
 for(const node of doc.querySelectorAll('[id],img,h1,h2,h3,h4,h5,h6,a[href]')){
  if(node.id){if(ids.has(node.id))add('dupId',node,node.id);ids.add(node.id);}
  if(node.localName==='img'&&!node.hasAttribute('alt'))add('missingAlt',node,node.getAttribute('src')??'');
  if(/^H[1-6]$/.test(node.tagName)){
   const next=Number(node.tagName[1]);if(next>level+1)add('badHeading',node,node.textContent);level=next;
  }
  if(node.localName!=='a')continue;
  const label=node.getAttribute('aria-label')||node.textContent.trim()||node.querySelector('img[alt]')?.alt||node.getAttribute('title');
  if(!label&&!node.getAttribute('aria-labelledby')?.split(/\s+/).some(id=>doc.getElementById(id)?.textContent.trim()))add('emptyLink',node);
  const href=node.getAttribute('href');let url;try{url=new URL(href,pageURL);}catch{add('brokenLink',node,href);continue;}
  const page=savedPageLink(href,pageURL,directory,pages);
  if(url.origin===directory.origin&&/\.html$/.test(url.pathname)&&!page){add('brokenLink',node,href);continue;}
  if(page?.path===path&&page.hash){let id;try{id=decodeURIComponent(page.hash.slice(1));}catch{}
   if(!doc.getElementById(id)&&!doc.getElementsByName(id).length)add('brokenLink',node,href);
  }
 }
 return issues;
}
