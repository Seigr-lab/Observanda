import {websiteReviewModel} from './website-review-model.js';
import {validWebsiteLink} from './website-files-text-link.js';

const windowSize=12;
const normalize=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function reviewSavedWebsite({site,directory,request,signal,t,edit,trigger,onError}){
 const dialog=document.createElement('dialog'),controller=new AbortController(),stop=AbortSignal.any([signal,controller.signal]);
 dialog.className='website-author-dialog website-site-review';dialog.dataset.websiteSiteReview='';
 function el(tag,parent,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;parent.append(n);return n;}
 function btn(parent,label,click){const b=el('button',parent,label);b.type='button';b.className='button';b.onclick=click;return b;}
 const header=el('header',dialog),heading=el('h2',header,t('checkWebsite'));heading.id='saved-website-review-title';dialog.setAttribute('aria-labelledby',heading.id);
 el('p',header,site.name+' · '+t('websiteReviewScope'));
 const main=el('div',dialog);main.className='website-review-body';
 const status=el('p',header,t('websiteReviewStarting'));status.setAttribute('role','status');status.setAttribute('aria-label',t('checkWebsite'));
 const progress=el('progress',main);progress.setAttribute('aria-label',t('checkWebsite'));
 const report=el('div',main);report.hidden=true;
 const searchLabel=el('label',report,t('websiteReviewFilter')),search=el('input',searchLabel);search.type='search';
 const workspace=el('div',report);workspace.className='website-review-findings';
 const sidebar=el('section',workspace),details=el('section',workspace);
 const filesList=el('div',sidebar);filesList.className='website-review-file-list';
 const fileNav=el('div',sidebar);fileNav.className='inline-actions';
 const prevFile=btn(fileNav,t('prevPage'),()=>moveFile(-1)),nextFile=btn(fileNav,t('nextPage'),()=>moveFile(1));
 const footer=el('footer',dialog);btn(footer,t('websiteReviewClose'),()=>dialog.close());
 let model,files=[],matches=[],offset=0,selected=null,issueOffset=0,drawId=0;
 const pin={siteId:site.id,expectedRevision:site.revision};
 async function checkPin(){
  const version=await request('version',{siteId:site.id},{signal:stop});
  stop.throwIfAborted();if(version.revision!==site.revision)throw Object.assign(Error(t('changed')),{code:'WEBSITE_CHANGED'});
 }
 function fail(reason){
  if(stop.aborted)return;
  report.hidden=progress.hidden=true;details.replaceChildren();status.textContent=reason.message||t('failed');
  if(['ACCESS_LOCKED','AUTH','WEBSITE_CHANGED','CONFLICT','PUBLICATION_PERMISSIONS_CHANGED'].includes(reason.code)){dialog.close();onError(reason);}
 }
 async function openFinding(path,issue,repair){
  try{await checkPin();dialog.close();await edit(path,issue,repair);}
  catch(reason){if(!stop.aborted)fail(reason);else if(reason.name!=='AbortError')onError(reason);}
 }
 function editor(item,path,issue){
  const link=issue.key==='brokenLink'||issue.key==='draftLink';
  if(issue.elementPath==null||!link&&!['missingAlt','emptyLink'].includes(issue.key))return;
  const widget=el('details',item);el('summary',widget,t('websiteReviewRepair'));
  const form=el('form',widget),label=el('label',form,t(link?'linkTarget':issue.key==='emptyLink'?'websiteReviewLinkName':'altText')),input=el('input',label);
  if(link)input.value=issue.href;
  input.required=true;
  let decorative;
  if(issue.key==='missingAlt'){
   const choice=el('label',form);decorative=el('input',choice);decorative.type='checkbox';choice.append(' '+t('websiteReviewDecorative'));
   decorative.onchange=()=>{input.disabled=decorative.checked;input.required=!decorative.checked;};
  }
  const submit=el('button',form,t('websiteReviewApply'));submit.className='button';submit.type='submit';
  input.oninput=()=>input.setCustomValidity('');
  form.onsubmit=async e=>{
   e.preventDefault();const value=decorative?.checked?'':input.value.trim();
   if(!decorative?.checked&&!value||link&&!validWebsiteLink(value,new URL(path,directory).href)){
    input.setCustomValidity(t(link?'badLink':'websiteReviewRequired'));input.reportValidity();return;
   }
   try{
    if(link&&!await model.linkExists(value,path)){input.setCustomValidity(t('brokenLink'));input.reportValidity();return;}
    await openFinding(path,issue,{value});
   }catch(reason){fail(reason);}
  };
 }
 async function drawDetails(focusHeading=false){
  const id=++drawId,path=selected;details.replaceChildren();
  if(!path)return;
  try{
   const result=await model.findings(path,issueOffset,windowSize);
   if(stop.aborted||id!==drawId)return;
   const section=el('h3',details,model.pages.get(path)?.title||path);section.tabIndex=-1;
   if(section.textContent!==path)el('code',details,path);
   const list=el('ul',details);
   for(const issue of result.items){
    const item=el('li',list),row=el('div',item);row.className='website-review-finding';
    const description=el('div',row);el('strong',description,t(issue.key));if(issue.detail)el('code',description,issue.detail);
    if(model.pages.has(path)||path===site.cssPath)btn(row,t(issue.feedId?'websiteReviewFeed':'websiteReviewOpen'),()=>void openFinding(path,issue));
    editor(item,path,issue);
   }
   if(result.total>windowSize){
    const nav=el('div',details);nav.className='inline-actions';
    btn(nav,t('prevPage'),()=>{issueOffset-=windowSize;void drawDetails(true);}).disabled=issueOffset===0;
    el('span',nav,t('websiteReviewRange',{first:issueOffset+1,last:issueOffset+result.items.length,total:result.total}));
    btn(nav,t('nextPage'),()=>{issueOffset+=windowSize;void drawDetails(true);}).disabled=issueOffset+result.items.length>=result.total;
   }
   if(focusHeading)section.focus();
  }catch(reason){fail(reason);}
 }
 function drawFiles(focusSelection=false){
  filesList.replaceChildren();
  const slice=matches.slice(offset,offset+windowSize);
  if(!slice.some(f=>f.path===selected)){selected=slice[0]?.path;issueOffset=0;}
  for(const {path,total} of slice){
   const b=btn(filesList,path+' ('+total+')',()=>{selected=path;issueOffset=0;drawFiles(true);});b.setAttribute('aria-pressed',String(path===selected));
  }
  if(!slice.length)el('p',filesList,t('websiteReviewNoMatches'));
  fileNav.hidden=matches.length<=windowSize;prevFile.disabled=offset===0;nextFile.disabled=offset+windowSize>=matches.length;
  if(focusSelection)filesList.querySelector('[aria-pressed=true]')?.focus();
  void drawDetails();
 }
 function moveFile(direction){offset+=direction*windowSize;drawFiles(true);}
 search.oninput=()=>{const q=normalize(search.value);matches=files.filter(f=>normalize(f.path+' '+(model.pages.get(f.path)?.title??'')).includes(q));offset=0;drawFiles();};
 async function start(){
  const catalogue=await request('review/catalogue',pin,{signal:stop});stop.throwIfAborted();
  const draftNames=new Set([...site.pages,...(site.feedPages??[])].filter(p=>p.draft).map(p=>p.path));
  model=websiteReviewModel({catalogue,directory,draftNames,signal:stop,read:async(path,signal)=>{
   const response=await fetch(new URL(path,directory),{signal,redirect:'error',cache:'no-store'});
   if(!response.ok){await checkPin();throw Error(t('websiteReviewRead',{path}));}return response.text();
  }});
  let count=0;progress.max=Math.max(model.subjects.length,1);progress.value=0;
  for(const path of model.subjects){
   const {total}=await model.findings(path);
   if(total){files.push({path,total});count+=total;}
   progress.value++;
  }
  await checkPin();progress.hidden=true;
  status.textContent=t(count?'websiteReviewSummary':'websiteReviewClear',{count,files:files.length,total:model.subjects.length});
  matches=files;report.hidden=!count;if(count)drawFiles();
 }
 dialog.addEventListener('close',()=>{controller.abort();dialog.remove();if(trigger?.isConnected)trigger.focus();},{once:true});
 signal.addEventListener('abort',()=>dialog.close(),{once:true,signal:controller.signal});
 document.body.append(dialog);dialog.showModal();void start().catch(fail);
}
