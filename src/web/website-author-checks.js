import {savedFileReference} from './website-files-navigation.js';
import {imageResourceURLs} from './website-image-candidates.js';
import {decodedWebsiteCSS,websiteCSSURLs} from './website-css-urls.js';
import {fragmentIssue,pageAnchors} from './website-reference-targets.js';
import {idTokens,referenceAttributes,referenceIssue,semanticIdIndex} from './website-semantic-model.js';

function visibleText(node){
 if(node.nodeType===3)return node.textContent;
 if(node.nodeType!==1||node.matches('script,style,template,[hidden],[aria-hidden="true"]'))return '';
 if(node.localName==='img')return node.getAttribute('alt')??'';
 return Array.from(node.childNodes,visibleText).join('');
}
export function checkAuthoredPage(doc,path,directory,pages,{files,crossLink,anchors=pageAnchors(doc),pageNames,draftNames}={}){
 const issues=[],pageURL=new URL(path,directory),ids=new Set();
 const add=(key,node,detail='')=>issues.push({key,node,detail:String(detail).slice(0,200)});
 if(!pageNames){const sourceDraft=pages.find(page=>page.path===path)?.draft===true;pageNames=new Set(pages.filter(p=>sourceDraft||!p.draft).map(p=>p.path));draftNames=new Set(pages.filter(p=>!sourceDraft&&p.draft).map(p=>p.path));}
 if(!doc.title.trim())add('missingTitle',doc.documentElement);
 if(!doc.documentElement.lang.trim())add('missingLang',doc.documentElement);
 const check=(raw,node,link)=>{
  let url;try{url=new URL(raw,pageURL);}catch{add(link?'brokenLink':'missingFile',node,raw);return;}
  if(url.origin!==directory.origin)return;
  const ref=savedFileReference(raw,pageURL,directory);
  if(link&&ref&&draftNames?.has(ref.path)){add('draftLink',node,raw);return;}
  if(!ref||((files||ref.path.endsWith('.html'))&&!(files?.has(ref.path)??pageNames.has(ref.path)))){
   add(link?'brokenLink':'missingFile',node,raw);return;
  }
  if(!link||!ref.hash||!pageNames.has(ref.path))return;
  let id;try{id=decodeURIComponent(ref.hash.slice(1));}catch{add('brokenLink',node,raw);return;}
  if(ref.path===path){const issue=fragmentIssue(anchors,id);if(issue)add(issue,node,raw);}
  else crossLink?.({path:ref.path,id,node,href:raw});
 };
 let level=0;
 let references;
 for(const node of doc.querySelectorAll('[id],img,h1,h2,h3,h4,h5,h6,a[href],video,table,[src],[srcset],[poster],link[href],use[href],image[href],[style],style,[aria-labelledby],[aria-describedby],[headers],[role="region"]')){
  if(node.id){if(ids.has(node.id))add('dupId',node,node.id);ids.add(node.id);}
  const hidden=node.closest('[hidden],[aria-hidden="true"]');
  if(!hidden){
   for(const attr of referenceAttributes)if(node.hasAttribute(attr)){
    references??=semanticIdIndex(doc);
    for(const id of new Set(idTokens(node.getAttribute(attr)))){const issue=referenceIssue(node,attr,id,references);if(issue)add(issue,node,attr+' · '+id);}
   }
   if(node.getAttribute('role')==='region'&&!node.getAttribute('aria-label')?.trim()&&!node.getAttribute('aria-labelledby')?.trim()&&!node.getAttribute('title')?.trim())add('semanticRegionName',node);
   if(node.localName==='img'&&!node.hasAttribute('alt'))add('missingAlt',node,node.getAttribute('src')??'');
   else if(node.localName==='img'&&node.getAttribute('role')==='img'&&!node.alt.trim())add('accessImageText',node,node.getAttribute('src')??'');
   if(/^H[1-6]$/.test(node.tagName)){
    const next=Number(node.tagName[1]);if(next>level+1)add('badHeading',node,node.textContent);level=next;
   }
   if(node.localName==='video'&&!node.querySelector('track[kind="captions" i]'))add('reviewCaptions',node);
   if(node.localName==='table'&&!['none','presentation'].includes(node.getAttribute('role'))&&![...node.querySelectorAll('th,[role="columnheader"],[role="rowheader"]')].some(cell=>cell.closest('table')===node))add('reviewTableHeaders',node);
  }
  if(node.localName==='a'&&node.hasAttribute('href')){
   const label=node.getAttribute('aria-label')?.trim()||visibleText(node).trim()||node.getAttribute('title')?.trim();
   if(!hidden&&!label&&!node.getAttribute('aria-labelledby')?.split(/\s+/).some(id=>doc.getElementById(id)?.textContent.trim()))add('emptyLink',node);
   check(node.getAttribute('href'),node,true);
  }
  if(!files)continue;
  for(const key of ['src','poster'])if(node.hasAttribute(key))check(node.getAttribute(key),node,false);
  if(node.hasAttribute('srcset'))for(const url of imageResourceURLs('srcset',node.getAttribute('srcset')))check(url,node,false);
  if(['link','image','use'].includes(node.localName)&&node.hasAttribute('href'))check(node.getAttribute('href'),node,false);
  if(node.hasAttribute('style')||node.localName==='style')for(const url of websiteCSSURLs(decodedWebsiteCSS(node.localName==='style'?node.textContent:node.getAttribute('style'))))check(url,node,false);
 }
 return issues;
}
