import {t} from './i18n/index.js';
const text=(key,values)=>t('publication',key,values);
export function publicationPageChoices(p,{esc,option}){
 const window=p.pagesWindow??{items:p.pages,total:p.pages.length,offset:0,next:null},rows=window.items;
 return `<select id="preview-page">${rows.some(page=>page.path===p.currentPage)?'':option('',text('choosePreviewPage'),'')}${rows.map(page=>option(page.path,page.title,p.currentPage)).join('')}</select>`+(window.total>rows.length?`<div class="inline-actions"><button class="button" data-action="publication-review-pages" data-offset="${Math.max(0,window.offset-32)}" ${window.offset?'':'disabled'}>${esc(text('previousChoices'))}</button><span role="status">${esc(text('choicesPosition',{start:window.offset+1,end:window.offset+rows.length,total:window.total}))}</span><button class="button" data-action="publication-review-pages" data-offset="${window.offset+rows.length}" ${window.offset+rows.length<window.total?'':'disabled'}>${esc(text('nextChoices'))}</button></div>`:'');
}
export function publicationReferenceChoices(p,{esc}){
 const window=p.referenceReviewsWindow??{items:p.researchReview?.references?.items??[],offset:0,total:p.researchReview?.references?.count??0},rows=window.items;
 return `<ul>${rows.map(row=>`<li>${esc(text('unresolvedRecord',row))}</li>`).join('')}</ul>`+(window.total>rows.length?`<div class="inline-actions"><button class="button" data-action="publication-review-references" data-offset="${Math.max(0,window.offset-16)}" ${window.offset?'':'disabled'}>${esc(text('previousReferences'))}</button><span role="status">${esc(text('referencesPosition',{start:window.offset+1,end:window.offset+rows.length,total:window.total}))}</span><button class="button" data-action="publication-review-references" data-offset="${window.offset+rows.length}" ${window.offset+rows.length<window.total?'':'disabled'}>${esc(text('nextReferences'))}</button></div>`:'');
}
export function publicationReviewChoicesUI({state,api,esc,option}){
 const generations={pages:0,references:0};let following=0;
 const current=preview=>state.page==='review'&&state.preview===preview;
 async function load(kind,{offset=0,path}={},accept=()=>true){
  const preview=state.preview;if(!preview||!current(preview))return;const stamp=++generations[kind];
  const owns=()=>stamp===generations[kind]&&current(preview)&&accept();let result;
  try{result=await api('/api/publication-jobs/'+kind,{id:preview.id,offset,...(path?{path}:{}),limit:kind==='pages'?32:16},{adopt:false,websitePin:preview.websitePin});}
  catch(error){if(owns())throw error;return;}
  if(!owns())return;
  if(kind==='pages'){preview.pagesWindow=result;preview.pages=result.items;const mount=document.getElementById('publication-page-choices');if(mount)mount.innerHTML=publicationPageChoices(preview,{esc,option});}
  else{preview.referenceReviewsWindow=result;const mount=document.getElementById('publication-reference-choices');if(mount)mount.innerHTML=publicationReferenceChoices(preview,{esc});}
 }
 async function follow(frame,prefix){
  const preview=state.preview;if(!preview||!current(preview)||frame.isConnected===false)return;
  let url;try{url=new URL(frame.contentWindow.location.href);}catch{return;}
  if(url.origin!==location.origin||!url.pathname.startsWith(prefix))return;
  const stamp=++following,path=url.pathname.slice(prefix.length),source=frame.src,selected=preview.currentPage;
  const owns=()=>{
   if(stamp!==following||!current(preview)||frame.isConnected===false||frame.src!==source||preview.currentPage!==selected)return false;
   try{const now=new URL(frame.contentWindow.location.href);return now.origin===url.origin&&now.pathname===url.pathname;}catch{return false;}
  };
  if(!preview.pages.some(page=>page.path===path)){if(!preview.pagesWindow)return;await load('pages',{path},owns);}
  if(!owns())return;
  preview.currentPage=path;preview.url=url.pathname;const select=document.getElementById('preview-page'),link=document.getElementById('full-public-preview');if(select)select.value=path;if(link)link.href=url.pathname;
 }
 return {load,follow};
}
