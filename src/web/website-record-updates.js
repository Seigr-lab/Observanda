import {t} from './i18n/index.js';

// A website keeps the copy of each lab book record it places. Before
// publishing, the author sees which placed records the lab book changed since
// and chooses which copies to update. Records left as they are publish as they
// were placed, so this review never blocks publishing.
export function websiteRecordUpdates({api,esc,site,render,reopen}){
 const text=(key,args)=>esc(t('websiteFiles',key,args));
 let state=null;
 const pin=()=>{const opened=site();return opened?{siteId:opened.site.id,revision:opened.site.revision}:null;};
 const current=()=>{const scope=pin();return Boolean(state&&scope&&state.scope.siteId===scope.siteId&&state.scope.revision===scope.revision);};
 async function check({paint=true}={}){
  const scope=pin();if(!scope)return;
  const mine={scope,status:'checking'};state=mine;if(paint)render();
  try{
   const result=await api('/api/website-record-updates/check',{siteId:scope.siteId,expectedRevision:scope.revision},{owner:null,adopt:false});
   if(!result||!Array.isArray(result.items)||!Number.isSafeInteger(result.total))throw Error('');
   if(state===mine){state={scope,status:'done',result,selected:new Set(result.items.map(item=>item.sourceId))};render();}
  }catch(error){if(state===mine){state={scope,status:'failed',message:error?.message??''};render();}}
 }
 // Started while a review is drawn, so the first state is drawn by that same render.
 function ensure(){if(!current()&&state?.status!=='updating')void check({paint:false});}
 async function apply(){
  if(!current()||state.status!=='done'||!state.selected.size)return;
  const scope=state.scope,sourceIds=[...state.selected];state={...state,status:'updating'};render();
  try{
   const result=await api('/api/website-record-updates/apply',{siteId:scope.siteId,expectedRevision:scope.revision,sourceIds},{owner:null,adopt:false});
   state={scope:{siteId:scope.siteId,revision:result.revision},status:'updated',updated:result.updated};
   // Every page that shows these records now holds the new copies.
   await reopen();
   const updated=state.updated;await check({paint:false});if(state?.status==='done')state.updated=updated;render();
  }catch(error){state={scope,status:'failed',message:error?.message??''};render();}
 }
 function item(row){
  return '<li><label><input type="checkbox" data-website-record-update="'+esc(row.sourceId)+'"'+(state.selected.has(row.sourceId)?' checked':'')+'>'+esc(row.title)+'</label></li>';
 }
 function view(){
  ensure();
  const again='<button type="button" class="button" data-action="website-files-record-updates-check">'+text('recordUpdatesAgain')+'</button>';
  const done=state?.updated?'<p role="status">'+text('recordUpdatesDone',{count:state.updated})+'</p>':'';
  let body;
  if(!state||state.status==='checking')body='<p role="status">'+text('recordUpdatesChecking')+'</p>';
  else if(state.status==='updating'||state.status==='updated')body='<p role="status">'+text('recordUpdatesUpdating')+'</p>';
  else if(state.status==='failed')body='<p role="note">'+text('recordUpdatesUnavailable')+'</p>'+(state.message?'<p class="muted">'+esc(state.message)+'</p>':'')+again;
  else if(!state.result.items.length)body=done+'<p role="status">'+text('recordUpdatesCurrent')+'</p>';
  else body=done+'<p role="alert">'+text('recordUpdatesChanged',{count:state.result.total})+'</p><ul class="website-record-updates-items">'+state.result.items.map(item).join('')+'</ul>'+
   (state.result.truncated?'<p class="muted">'+text('recordUpdatesMore',{count:state.result.total-state.result.items.length})+'</p>':'')+
   '<p class="muted">'+text('recordUpdatesGuidance')+'</p><div class="inline-actions"><button type="button" class="button" data-action="website-files-record-updates-apply" data-website-file-requires-clean'+(state.selected.size?'':' disabled')+'>'+text('recordUpdatesApply')+'</button>'+again+'</div>';
  return '<section class="website-record-updates" data-website-record-updates><h4>'+text('recordUpdatesTitle')+'</h4>'+body+'</section>';
 }
 function input(element){
  if(!element.matches('[data-website-record-update]'))return false;
  if(current()&&state.status==='done'){if(element.checked)state.selected.add(element.dataset.websiteRecordUpdate);else state.selected.delete(element.dataset.websiteRecordUpdate);render();}
  return true;
 }
 return {view,input,check,apply,reset:()=>{state=null;}};
}
