import {t} from './i18n/index.js';
const tr=(key,parameters)=>t('localIntake',key,parameters);
export function localIntakeUI({api,frame,esc,field,guard,owner,workspace,refreshRecord,readinessUI}){
 let preview=null,source='',opened=null,timer=null,generation=0,cursor=null,listing=[];
 const stop=()=>{clearTimeout(timer);timer=null;generation++;};
 const call=(action,data={})=>api('/api/v1/intake/'+action,{version:1,workspaceId:workspace(),recordId:owner(),...data},{adopt:false});
 const button=(key,action,extra='',parameters)=>'<button type="button" class="button" data-action="material-continuing-'+action+'" '+extra+'>'+esc(tr(key,parameters))+'</button>';
 const pair=(key,value)=>'<dt>'+esc(tr(key))+'</dt><dd style="overflow-wrap:anywhere">'+esc(value)+'</dd>';
 const input=(key,value='')=>field(tr(key),'<input id="continuing-'+key+'" value="'+esc(value)+'">');
 async function home(){
  stop();const page=await call('list',{cursor});guard();listing=page.items;
  frame(tr('title'),'<p>'+esc(tr('intro'))+'</p><details><summary>'+esc(tr('identity'))+'</summary><dl>'+pair('workspace',workspace())+pair('identity',owner())+pair('revision',page.recordRevision)+'</dl></details>'+input('source',source)+button('choose','choose')+button('validate','preview')+'<p>'+esc(tr('validationOnly'))+'</p>'+button('readiness','readiness')+'<h3>'+esc(tr('list'))+'</h3>'+(listing.length?'<ul>'+listing.map((p,i)=>'<li>'+button('inspect','open','data-index="'+i+'"',{title:p.title})+' · '+esc(tr(p.state))+'</li>').join('')+'</ul>':'<p>'+esc(tr('noProposals'))+'</p>')+(cursor?button('latest','latest'):'')+(page.next?button('more','more','data-cursor="'+esc(page.next)+'"'):''));
 }
 function description(p){return '<h3>'+esc(p.title)+'</h3><dl>'+pair('identity',p.recordId)+pair('revision',p.expectedRevision)+pair('pin',p.pin)+pair('sourceRevision',p.source.revision)+pair('sourceSha256',p.source.sha256)+pair('verification',p.verification.statement)+'</dl>'+(p.changesRecord?'<p>'+esc(tr('changes'))+'</p>':'')+'<details><summary>'+esc(tr('files'))+' ('+p.files.length+')</summary><ul>'+p.files.map(f=>'<li style="overflow-wrap:anywhere">'+esc(f.path)+' · '+f.size+' B · '+f.sha256+'</li>').join('')+'</ul></details><details><summary>'+esc(tr('analyses'))+' ('+p.analyses.length+')</summary><ul>'+p.analyses.map(a=>'<li>'+esc(a.title)+' · '+esc(a.tool)+' '+esc(a.version)+'</li>').join('')+'</ul></details>';}
 async function show(id){
  stop();opened=id;const p=await call('status',{id});guard();
  frame(tr('preview'),description(p)+'<p role="status">'+esc(tr(p.state))+(p.job?' · '+esc(tr(p.job.state))+' · '+esc(tr('progress',p.job.progress)):'')+'</p>'+(p.job?.message?'<p role="alert">'+esc(p.job.message)+'</p>':'')+(p.receipt?'<details><summary>'+esc(tr('receipt'))+'</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(p.receipt,null,2))+'</pre></details>':''),button('back','home')+button('refresh','refresh')+(p.state==='prepared'?button('apply','apply','data-pin="'+p.pin+'"'):'')+(p.job&&['queued','running'].includes(p.job.state)?button('cancel','cancel'):'')+(p.job&&['failed','cancelled'].includes(p.job.state)?button('resume','resume'):''));
  if(p.job&&['queued','running'].includes(p.job.state)){const at=generation;timer=setTimeout(()=>{if(at===generation)void show(id).catch(()=>stop());},750);}
  if(p.state==='completed'&&p.changesRecord)await refreshRecord();
 }
 async function action(control){
  const act=control.dataset.action?.replace('material-continuing-','');guard();control.disabled=true;
  try{
   if(act==='home'||act==='latest'||act==='more'){cursor=act==='more'?control.dataset.cursor:null;await home();}
   if(act==='choose'){const result=await api('/api/storage/pick',{path:document.getElementById('continuing-source').value},{adopt:false});guard();if(result.path)document.getElementById('continuing-source').value=result.path;}
   if(act==='preview'){source=document.getElementById('continuing-source').value;preview=await call('preview',{source});guard();frame(tr('preview'),description(preview)+'<p>'+esc(tr('validationOnly'))+'</p>',button('back','home')+button('stage','stage'));}
   if(act==='stage'){const p=await call('stage',{source,id:preview.id,expectedPin:preview.pin});guard();await show(p.id);}
   if(act==='open')await show(listing[Number(control.dataset.index)].id);
   if(act==='refresh')await show(opened);
   if(act==='apply'){await call('apply',{id:opened,expectedPin:control.dataset.pin});guard();await show(opened);}
   if(act==='cancel'||act==='resume'){await call(act,{id:opened});guard();await show(opened);}
   if(act==='readiness'){stop();await readinessUI.home();}
  }finally{if(control.isConnected)control.disabled=false;}
  return true;
 }
 return {home,action,stop};
}
