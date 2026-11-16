// The GitHub repository behind a website's publishing destination: create a
// new one, or give an empty one its first commit, before the first publication.
// Each runs as a durable job on the server; this panel starts it and follows it.
export function websiteFilesRepository({request,siteId,destination,reload,esc,tr,render}){
 let review=null,job=null,empty=false,visibility='public',confirmed=false,timer=0;
 const name=config=>config.github.owner+'/'+config.github.repository;
 const button=(key,action,extra='')=>'<button type="button" class="button" data-action="website-files-repository-'+action+'" '+extra+'>'+esc(tr(key))+'</button>';
 function reset(){clearTimeout(timer);review=null;job=null;empty=false;confirmed=false;visibility='public';}
 function follow(){
  clearTimeout(timer);if(!job||!['queued','running'].includes(job.state))return;
  timer=setTimeout(async()=>{
   try{job=(await request('repository/status',{siteId:siteId(),id:job.id})).job;}catch{return;}
   if(job.state==='completed'){review=null;empty=false;await reload();return;}
   paint();follow();
  },800);
 }
 function status(){
  if(!job)return '';
  if(['queued','running'].includes(job.state))return '<p role="status" data-repository-status>'+esc(tr('repositoryRunning'))+'</p>'+button('repositoryStop','cancel');
  if(job.state==='completed')return '<p role="status" data-repository-status>'+esc(tr('repositoryReady'))+'</p>';
  return '<p role="alert" data-repository-status>'+esc(job.message||tr('repositoryFailed'))+'</p>'+button('repositoryRetry','retry');
 }
 // An always-present slot lets the panel follow the typed owner and repository
 // without redrawing the form being typed in.
 function view(){const current=destination();return current?.config.kind==='github'?'<div data-repository-slot>'+section()+'</div>':'';}
 function paint(){const slot=document.querySelector('[data-repository-slot]');if(slot)slot.innerHTML=section();}
 function section(){
  const current=destination();if(!current||current.config.kind!=='github')return '';
  const config=current.config,named=config.github.owner&&config.github.repository,running=job&&['queued','running'].includes(job.state);
  let body='';
  if(!current.configured&&named){
   body='<p>'+esc(tr('repositoryCreateHelp',{name:name(config)}))+'</p><label for="website-repository-visibility">'+esc(tr('repositoryVisibility'))+'</label><select id="website-repository-visibility" data-repository-visibility><option value="public"'+(visibility==='public'?' selected':'')+'>'+esc(tr('repositoryPublic'))+'</option><option value="private"'+(visibility==='private'?' selected':'')+'>'+esc(tr('repositoryPrivate'))+'</option></select>'+
    '<label><input type="checkbox" data-repository-confirm'+(confirmed?' checked':'')+'>'+esc(tr('repositoryCreateConfirm',{name:name(config)}))+'</label>'+button('repositoryCreate','create',confirmed&&!running?'':'disabled');
  }else if(current.configured&&(empty||review)){
   body=review?'<p>'+esc(tr('repositoryReviewText',{name:review.name,branch:review.branch}))+'</p><label><input type="checkbox" data-repository-confirm'+(confirmed?' checked':'')+'>'+esc(tr('repositoryInitializeConfirm',{name:review.name}))+'</label>'+button('repositoryInitialize','initialize',confirmed&&!running?'':'disabled')
    :'<p>'+esc(tr('repositoryEmptyHelp'))+'</p>'+button('repositoryCheck','review');
  }
  if(!body&&!job)return '';
  return '<section class="website-files-repository" data-website-files-repository aria-labelledby="website-repository-title"><h3 id="website-repository-title">'+esc(tr('repositoryTitle'))+'</h3>'+body+status()+'</section>';
 }
 function input(element){
  if(element.matches('[data-repository-visibility]')){visibility=element.value==='private'?'private':'public';return true;}
  if(element.matches('[data-repository-confirm]')){confirmed=element.checked;paint();return true;}
  return false;
 }
 async function action(operation){
  const current=destination(),id=siteId();
  if(operation==='create'){
   // A new repository starts on main, so the website branch is main.
   const config=structuredClone(current.config);config.github.branch='main';
   job=(await request('repository/start',{siteId:id,config,etag:current.etag,visibility,confirmed})).job;confirmed=false;render();follow();return;
  }
  if(operation==='review'){review=await request('repository/review',{siteId:id,configEtag:current.etag});confirmed=false;render();return;}
  if(operation==='initialize'){job=(await request('repository/initialize',{siteId:id,review:review.id,configEtag:current.etag,confirmed})).job;confirmed=false;render();follow();return;}
  if(operation==='retry'||operation==='cancel'){job=(await request('repository/'+operation,{siteId:id,id:job.id})).job;render();follow();}
 }
 // Resume following a setup that was running when the panel was last open.
 async function refresh(){const current=(await request('repository/current',{siteId:siteId()})).job;job=current&&current.state!=='completed'?current:null;follow();}
 return {view,paint,input,action,reset,refresh,markEmpty(){empty=true;review=null;},destroy(){clearTimeout(timer);}};
}
