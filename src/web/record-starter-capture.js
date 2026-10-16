import {t} from './i18n/index.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';

// Retain choices by section identity, not by the currently visible page. Only
// the explicit prepare action requests chosen instruction bodies.
export function recordStarterCapture({api,esc,frame,valid,onPrepared}){
 const text=(key,args)=>t('recordStarters',key,args);
 let session=null,controller=null;
 const button=(key,action,disabled=false)=>'<button type="button" class="button" data-action="starter-source-'+action+'"'+(disabled?' disabled':'')+'>'+esc(text(key))+'</button>';
 const current=s=>s===session&&valid()&&document.querySelector('#dialog[open] [data-starter-source]');
 function stop(){controller?.abort();controller=null;session=null;}
 function paint(){
  const s=session;if(!s||!valid())return;
  const page=s.page;
  frame(text('capture'),'<form id="starter-source-form" data-starter-source data-no-draft aria-busy="'+s.busy+'">'+
   '<p>'+esc(text('sourceHelp'))+'</p>'+(page?'<p><strong>'+esc(page.title)+'</strong></p>':'')+
   '<p role="alert">'+esc(s.error)+'</p>'+(s.error?button('retry','retry',s.busy):'')+
   (s.busy?'<p role="status">'+esc(text('sourceLoading'))+'</p>':'')+
   '<label class="checkbox"><input type="checkbox" data-source-summary '+(s.body?'checked ':'')+(s.busy?'disabled':'')+'>'+esc(text('copyBody'))+'</label>'+
   '<p role="status" data-source-count>'+esc(text('sourceSelected',{count:s.chosen.size}))+'</p>'+
   (page?'<p>'+esc(page.total?text('sourceRange',{first:page.offset+1,last:page.offset+page.values.length,total:page.total}):text('sourceEmpty'))+'</p>'+page.values.map(item=>{
    const choice=s.chosen.get(item.id);return '<fieldset><legend>'+esc(text('sourceSection',{number:item.position+1,title:item.title}))+'</legend>'+
     '<label class="checkbox"><input type="checkbox" data-source-section="'+item.id+'" '+(choice?'checked ':'')+(s.busy?'disabled':'')+'>'+esc(text('sourceInclude'))+'</label>'+
     '<label class="checkbox"><input type="checkbox" data-source-body="'+item.id+'" '+(choice?.body?'checked ':'')+(s.busy||!choice?'disabled':'')+'>'+esc(text('copySection',{title:item.title}))+'</label></fieldset>';
   }).join('')+'<div class="inline-actions">'+button('sourcePrevious','previous',s.busy||page.offset===0)+button('sourceNext','next',s.busy||page.offset+page.values.length>=page.total)+'</div>'+
   (page.total?'<div class="inline-actions"><label class="field">'+esc(text('sourceGoTo'))+'<input type="number" data-source-position required min="1" max="'+page.total+'" value="'+(page.offset+1)+'" '+(s.busy?'disabled':'')+'></label>'+button('sourceGo','go',s.busy)+'</div>':''):'')+
   '<p>'+esc(text('discardedResults'))+'</p><div class="dialog-actions"><button type="button" class="button" data-action="starter-list">'+esc(text('back'))+'</button><button type="submit" class="button primary" '+(s.busy||!page?'disabled':'')+'>'+esc(text('prepare'))+'</button></div></form>');
  const root=document.querySelector('[data-starter-source]');
  root.addEventListener('change',event=>{
   if(s!==session||s.busy)return;const input=event.target;
   if(input.matches('[data-source-summary]'))s.body=input.checked;
   else if(input.matches('[data-source-section]')){
    const id=input.dataset.sourceSection,body=root.querySelector('[data-source-body="'+id+'"]');
    if(input.checked)s.chosen.set(id,{id,body:false,position:page.values.find(item=>item.id===id).position});else s.chosen.delete(id);body.disabled=!input.checked;body.checked=false;
   }else if(input.matches('[data-source-body]')){const value=s.chosen.get(input.dataset.sourceBody);if(value)value.body=input.checked;}
   root.querySelector('[data-source-count]').textContent=text('sourceSelected',{count:s.chosen.size});
  });
 }
 function validatePage(result,s,offset){
  if(!result||Object.entries(s.target).some(([key,value])=>result[key]!==value)||!revisionId(result.storageRevision)||s.page&&s.page.storageRevision!==result.storageRevision||typeof result.title!=='string'||typeof result.type!=='string'||result.offset!==offset||!Number.isSafeInteger(result.total)||result.total<offset||!Array.isArray(result.values)||result.values.length!==Math.min(20,result.total-offset)||new Set(result.values.map(item=>item.id)).size!==result.values.length||result.values.some((item,i)=>!researchId(item.id)||typeof item.title!=='string'||item.position!==offset+i))throw Error(text('sourceIncomplete'));
  return result;
 }
 async function load(offset){
  const s=session;if(!s)return;controller?.abort();const request=new AbortController();controller=request;s.busy=true;s.error='';s.requested=offset;paint();
  try{
   const result=await api('/api/research/starters/source',{...s.target,offset},{adopt:false,signal:request.signal});
   if(!current(s)||request.signal.aborted)return;s.page=validatePage(result,s,offset);
  }catch(error){if(current(s)&&!request.signal.aborted)s.error=error.message;}
  finally{if(current(s)&&controller===request){controller=null;s.busy=false;paint();}}
 }
 async function submit(form){
  if(form.id!=='starter-source-form')return false;const s=session;if(!current(s)||s.busy||!s.page)return true;
  controller=new AbortController();const request=controller;s.busy=true;s.error='';paint();
  try{
   const chosen=[...s.chosen.values()].sort((a,b)=>a.position-b.position),marker=JSON.stringify({body:s.body,chosen});if(s.prepared!==marker){s.id=crypto.randomUUID();s.prepared=marker;}
   const call=(operation,data)=>api('/api/research/starters/capture-'+operation,{workspaceId:s.target.workspaceId,id:s.id,...data},{adopt:false,signal:request.signal});
   const start=await call('begin',{recordId:s.target.recordId,snapshotId:s.target.snapshotId,body:s.body});
   for(let index=start.received;index<chosen.length;index+=20)await call('append',{index,sections:chosen.slice(index,index+20)});
   const result=await call('finish',{count:chosen.length});
   if(!current(s)||request.signal.aborted)return true;
   if(result?.header?.id!==s.id||!revisionId(result.header.revision))throw Error(text('sourceIncomplete'));
   stop();await onPrepared(result);
  }catch(error){if(current(s)&&!request.signal.aborted)s.error=error.message;}
  finally{if(current(s)&&controller===request){controller=null;s.busy=false;paint();}}
  return true;
 }
 return {stop,submit,async start(target){stop();session={target,chosen:new Map(),body:false,page:null,busy:false,error:'',requested:0};await load(0);},async action(control){
  if(!control.dataset.action?.startsWith('starter-source-'))return false;
  const s=session;if(!current(s)||s.busy)return true;
  const action=control.dataset.action.slice('starter-source-'.length);
  if(action==='retry')await load(s.requested);
  else if(action==='previous')await load(Math.max(0,s.page.offset-20));
  else if(action==='next')await load(s.page.offset+s.page.values.length);
  else if(action==='go'){const input=document.querySelector('[data-source-position]');if(input.reportValidity())await load(Number(input.value)-1);}
  return true;
 }};
}
