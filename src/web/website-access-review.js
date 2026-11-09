import {checkAuthoredPage} from './website-author-checks.js';
import {websiteHTML,loadWebsiteCanvas} from './website-html-document.js';
import {renderedWebsiteChecks} from './website-rendered-checks.js';
import {accessRepairKind} from './website-access-repairs.js';

const pageSize=12;
function element(parent,tag,text){
 const node=document.createElement(tag);if(text!==undefined)node.textContent=text;parent.append(node);return node;
}
function button(parent,label,fn){
 const node=element(parent,'button',label);node.type='button';node.className='button';node.onclick=fn;return node;
}
function field(parent,label,type,value){
 const wrap=element(parent,'label',label),input=element(wrap,'input');input.type=type;if(value!==undefined)input.value=value;return input;
}
function addresses(doc){
 const indexes=new WeakMap(),indexed=new WeakSet();
 return node=>{
  if(!doc.body.contains(node))return null;
  const path=[];
  while(node!==doc.body){
   const parent=node.parentElement;
   if(!indexed.has(parent)){let i=0;for(const child of parent.children)indexes.set(child,i++);indexed.add(parent);}
   path.push(indexes.get(node));node=parent;
  }
  return path.reverse().join('/');
 };
}
function findings(issues,address){
 return issues.map(({key,node,detail,manual})=>({key,tag:node.localName,address:address(node),detail,manual:!!manual,repair:accessRepairKind(key,node)}));
}
function repairControls(row,item,t,apply){
 if(!item.repair)return;
 const form=element(row,'form');form.className='website-access-repair';
 let inputs=()=>({});
 if(['image','name','accessDialog'].includes(item.repair)||item.repair==='accessMain'&&item.address!==''){
  const label=item.repair==='image'?'altText':item.repair==='accessDialog'?'accessExitLabel':'accessName';
  const input=field(form,t(label),'text',item.repair==='accessDialog'?t('finderClose'):undefined);input.required=true;
  const decorative=item.repair==='image'&&field(form,t('websiteReviewDecorative'),'checkbox');
  if(decorative)decorative.onchange=()=>{input.disabled=decorative.checked;input.required=!decorative.checked;};
  inputs=()=>({text:input.value.trim(),decorative:!!decorative?.checked});
 }else if(item.repair==='heading'){
  const select=element(element(form,'label',t('accessHeadingLevel')),'select');
  for(let level=1;level<=6;level++)select.add(new Option('H'+level,String(level)));
  inputs=()=>({level:select.value});
 }else if(item.repair==='colors'){
  const ink=field(form,t('sectionText'),'color','#162233'),paper=field(form,t('sectionBackground'),'color','#ffffff');
  inputs=()=>({ink:ink.value,paper:paper.value});
 }
 const submit=element(form,'button',t('websiteReviewApply'));submit.type='submit';submit.className='button';
 form.onsubmit=e=>{e.preventDefault();const values=inputs();if(values.text!==undefined&&!values.decorative&&!values.text)return;apply(item,values);};
}
export function showPageAccessibility({html,css,path,pages,directory,frameURL,styleURL,resource,t,select,apply,current,width,signal}){
 const modal=document.createElement('dialog');modal.className='website-author-dialog website-access-dialog';
 const life=new AbortController(),doc=websiteHTML(html),staticIssues=findings(checkAuthoredPage(doc,path,directory,pages),addresses(doc));
 const heading=element(modal,'h2',t('checkPage'));heading.id='website-access-heading';modal.setAttribute('aria-labelledby',heading.id);
 const tools=element(modal,'div');tools.className='website-access-tools';
 const selectWidth=element(element(tools,'label',t('viewportPixels')),'select');
 for(const px of [...new Set([width,375,768,1440])])selectWidth.add(new Option(px+' px',String(px)));
 const check=button(tools,t('accessRender'),inspect);
 const status=element(modal,'p');status.setAttribute('role','status');
 const group=element(modal,'div'),nav=element(modal,'nav'),end=element(modal,'footer');
 nav.className=end.className='website-access-tools';
 button(end,t('cancel'),()=>modal.close());
 let frame,inspection,rows=staticIssues,at=0,keys=[],showKeys=false;
 const mode=button(tools,t('accessKeyboard'),()=>{showKeys=!showKeys;at=0;draw();});
 mode.hidden=true;
 function fail(reason){if(life.signal.aborted)return;status.textContent=reason.message||t('failed');}
 function draw(){
  nav.replaceChildren();group.replaceChildren();const list=element(group,'ul'),items=showKeys?keys:rows;
  mode.setAttribute('aria-pressed',String(showKeys));
  if(!items.length)element(group,'p',t(showKeys?'accessNoKeys':'noIssues'));
  for(const item of items.slice(at,at+pageSize)){
   const row=element(list,'li');
   if(showKeys)element(row,'strong',String(item.sequence)+'. '+item.detail);
   else{
    const title=element(row,'strong',t(item.key));
    element(row,'small',t(item.manual?'accessManual':'accessAutomatic'));
    if(item.detail)element(row,'p',String(item.detail).slice(0,220));
    title.tabIndex=-1;
   }
   if(item.address)button(row,t('websiteReviewOpen'),()=>{if(!current())return modal.close();modal.close();select(item.address);});
   if(item.repair){
    const disclosure=element(row,'details');element(disclosure,'summary',t('websiteReviewRepair'));
    repairControls(disclosure,item,t,(issue,values)=>{
     if(!current())return modal.close();
     try{apply(issue,values);modal.close();}catch(error){fail(error);}
    });
   }
  }
  if(items.length>pageSize){
   button(nav,t('prevPage'),()=>{at-=pageSize;draw();}).disabled=!at;
   element(nav,'span',t('websiteReviewRange',{first:at+1,last:Math.min(items.length,at+pageSize),total:items.length}));
   button(nav,t('nextPage'),()=>{at+=pageSize;draw();}).disabled=at+pageSize>=items.length;
  }
 }
 function inspect(){
  inspection?.abort();frame?.remove();inspection=new AbortController();
  const stop=AbortSignal.any([life.signal,inspection.signal]);keys=[];showKeys=false;mode.hidden=true;check.disabled=true;
  status.textContent=t('accessMeasuring');frame=element(modal,'iframe');
  frame.className='website-access-measure';frame.title=t('accessRender');frame.tabIndex=-1;frame.setAttribute('aria-hidden','true');
  frame.setAttribute('sandbox','allow-same-origin');frame.style.width=selectWidth.value+'px';
  const measuring=frame;
  const valid=()=>!stop.aborted&&modal.open&&current();
  measuring.onload=async()=>{
   if(!valid()||measuring.contentDocument?.URL==='about:blank')return;
   try{
    const target=measuring.contentDocument;
    if(!target||new URL(target.URL).pathname!==new URL(frameURL).pathname||target.contentType!=='text/html')throw Error(t('changed'));
    loadWebsiteCanvas(target,html,css,styleURL,resource);
    const links=Array.from(target.querySelectorAll('link[rel=stylesheet][href]'),link=>link.sheet?Promise.resolve():new Promise((resolve,reject)=>{
     link.addEventListener('load',resolve,{once:true});link.addEventListener('error',()=>reject(Error(t('accessStylesUnavailable'))),{once:true});
    }));
    await Promise.all(links);await target.fonts.ready;if(!valid())return;
    const result=await renderedWebsiteChecks(target,{signal:stop});if(!valid())return;
    const address=addresses(target);rows=[...staticIssues,...findings(result.issues,address)];
    keys=result.keyboard.map(({node,label},i)=>({sequence:i+1,key:'accessFocus',tag:node.localName,address:address(node),detail:label,repair:accessRepairKind('accessFocus',node)}));
    at=0;mode.hidden=!keys.length;status.textContent=t('accessResults',{count:rows.length,width:result.width});draw();
   }catch(error){if(valid())fail(error);}
   finally{if(!stop.aborted){check.disabled=false;measuring.remove();}}
  };
  measuring.src=frameURL;
 }
 signal.addEventListener('abort',()=>modal.close(),{once:true,signal:life.signal});
 modal.onclose=()=>{life.abort();frame?.remove();modal.remove();};
 selectWidth.onchange=inspect;status.textContent=t('accessBeforeRender');draw();
 document.body.append(modal);modal.showModal();
}
