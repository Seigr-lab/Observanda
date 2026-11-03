import {t} from './i18n/index.js';

const windowSize=6;
const kinds=['added','replaced','removed','unchanged','conflict'];
const kindLabel=kind=>'kind'+kind[0].toUpperCase()+kind.slice(1);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function labelFor(file,pages,msg){
 const page=file.after&&pages.find(page=>!page.draft&&page.path===file.path);
 if(page)return page.title||file.path;
 const name=file.path.split('/').at(-1);
 if(file.path==='publication.json')return msg('fileManifest');
 if(/^source-[a-f0-9]{64}\.css$/.test(name))return msg('fileSourceStyles');
 if(/^pictures\//.test(file.path)||/^assets\/.*\.(png|jpe?g|webp|avif|gif|svg)$/i.test(file.path))return msg('filePicture');
 if(/^recordings\//.test(file.path))return msg('fileRecording');
 if(/^[\da-f-]{32,}\.[a-z\d]+$/i.test(name))return msg('fileAsset');
 return file.path;
}

export function websiteFilesFolder({request,site,current=()=>true,esc,render}){
 const msg=(key,args)=>t('localExport',key,args),text=(key,args)=>esc(msg(key,args));
 let directory='',review=null,acknowledged=null,page=null,offset=0,native=false,session=0,epoch=0;
 const button=(key,op,disabled=false)=>'<button type="button" class="button'+(op==='apply'?' primary':'')+'" data-action="website-files-folder-'+op+'" '+(disabled?'disabled':'')+'>'+text(key)+'</button>';
 const pin=()=>({siteId:site().site.id,expectedRevision:site().site.revision});
 const matches=scope=>scope&&scope.siteId===site()?.site.id&&scope.expectedRevision===site().site.revision&&current();
 const command=(op,data,scope=pin())=>request('folder/'+op,{...scope,...data});
 const ready=()=>review&&page&&matches(review.scope)&&page.id===review.id&&page.reviewId===review.currentReviewId&&directory===page.directory&&!page.counts.conflict&&page.state!=='discarded'&&!(page.state==='completed'&&page.cleaned);
 const clearReview=()=>{epoch++;review=acknowledged=page=null;offset=0;};
 const focus=selector=>requestAnimationFrame(()=>document.querySelector('[data-folder-review-panel] '+selector)?.focus({preventScroll:true}));
 function view(){
  if(review&&!matches(review.scope))clearReview();
  if(!document.querySelector('link[data-sheet="website-files-folder"]')){
   const style=document.createElement('link');style.rel='stylesheet';style.href='/website-files-folder.css';style.dataset.sheet='website-files-folder';document.head.append(style);
  }
  return '<section class="panel website-files-publish website-folder" data-folder-review-panel><h2>'+esc(t('websiteFiles','folderPublish'))+'</h2><p>'+text('folderIntro')+'</p>'+
   '<div class="website-folder-destination"><label>'+text('folder')+'<input data-website-file-folder value="'+esc(directory)+'" autocomplete="off" spellcheck="false"></label>'+
   (native?button('choose','choose'):'')+button('review','plan',!directory.trim()||!current())+'</div>'+(review&&page?reviewView():'')+'</section>';
 }
 function fingerprint(label,value){
  return value?'<dt>'+text(label)+'</dt><dd>'+text('fileBytes',{count:value.bytes.toLocaleString(document.documentElement.lang||undefined)})+'<br><code>SHA-256 '+esc(value.sha256)+'</code></dd>':'';
 }
 function fileRow(file,pages){
  const label=labelFor(file,pages,msg),ext=file.path.split('/').at(-1).split('.').pop();
  return '<li data-file-change="'+esc(file.kind)+'"><details><summary><span class="website-folder-kind">'+text(kindLabel(file.kind))+'</span><strong>'+esc(label)+'</strong>'+
   (label!==file.path&&/^[a-z\d]{1,8}$/i.test(ext)?'<small>'+esc(ext.toUpperCase())+'</small>':'')+'</summary>'+
   '<dl><dt>'+text('exactPath')+'</dt><dd><code>'+esc(file.path)+'</code></dd>'+fingerprint('priorFile',file.before)+fingerprint('reviewedFile',file.after)+'</dl></details></li>';
 }
 function reviewView(){
  const counts=page.counts,previous=page.reviewId!==review.currentReviewId,complete=page.state==='completed'&&page.cleaned;
  const folder=page.directory.split(/[\\/]/).filter(Boolean).at(-1)??page.directory;
  const info='<div class="website-folder-summary"><div><h3 tabindex="-1" data-folder-heading>'+text('changes')+'</h3><p>'+text('folder')+' · <strong>'+esc(folder)+'</strong></p><p role="status">'+text(page.state,{done:page.applied,total:page.total})+'</p></div>'+
   '<ul aria-label="'+text('changes')+'">'+kinds.filter(kind=>counts[kind]||kind==='conflict').map(kind=>'<li data-file-change="'+kind+'" '+(counts[kind]?'data-present':'')+'>'+text(kind,{count:counts[kind]})+'</li>').join('')+'</ul></div>';
  const pages=previous?[]:[...site().site.pages,...(site().site.feedPages??[])],list=page.files.slice(offset-page.offset,offset-page.offset+windowSize);
  const rows='<section class="website-folder-files"><h4 tabindex="-1" data-folder-list>'+text('files')+'</h4><ul>'+list.map(file=>fileRow(file,pages)).join('')+'</ul>'+
   (page.total>windowSize?'<div class="website-folder-pagination">'+button('previous','previous',offset===0)+'<span aria-live="polite">'+text('fileRange',{first:offset+1,last:offset+list.length,total:page.total})+'</span>'+button('next','next',offset+list.length>=page.total)+'</div>':'')+'</section>';
  const examples=page.files.flatMap((file,i)=>file.kind==='conflict'?[{file,i}]:[]).slice(0,3);
  const conflict='<div role="alert"><p>'+text('conflictHelp')+'</p>'+examples.map(({file,i})=>'<button type="button" class="button" data-action="website-files-folder-conflict-'+i+'">'+text('inspectConflict',{name:labelFor(file,pages,msg)})+'</button>').join('')+'</div>';
  const confirm=complete?'<p>'+text('finished')+'</p>':previous?'<p role="alert">'+text('earlierFolder')+'</p>':counts.conflict?conflict:page.state==='discarded'?'':'<div class="website-folder-approval"><label><input type="checkbox" data-website-file-folder-confirm '+(acknowledged===review?'checked':'')+'>'+text('confirm')+'</label>'+button(page.state==='planned'?'apply':'resume','apply',!ready()||acknowledged!==review)+'</div>';
  return '<section data-folder-plan>'+info+rows+confirm+'</section>';
 }
 async function readPage(scope,id,at,ticket){
  const value=await command('page',{id,offset:at},scope);
  if(ticket!==epoch||!matches(scope))return false;
  if(value.id!==id||!hash(value.reviewId)||!Array.isArray(value.files)||value.offset!==at)throw Error(msg('confirmRequired'));
  if(page&&(page.state!==value.state||page.reviewId!==value.reviewId||page.directory!==value.directory||value.counts.conflict))acknowledged=null;
  page=value;offset=at;return true;
 }
 return {view,reset(initialDirectory=''){session++;native=false;directory=initialDirectory;clearReview();},async loadChooser(){
  const token=session,scope=pin();let capability;
  try{capability=await command('chooser',{},scope);}catch(error){if(['ACCESS_LOCKED','AUTH'].includes(error.code))throw error;return;}
  if(token===session&&matches(scope)&&capability?.mode==='native'){native=true;render();}
 },input(element){
  if(element.matches('[data-website-file-folder-confirm]')){
   acknowledged=element.checked&&ready()?review:null;
   const write=element.closest('[data-folder-plan]')?.querySelector('[data-action="website-files-folder-apply"]');if(write)write.disabled=!acknowledged;return true;
  }
  if(!element.matches('[data-website-file-folder]'))return false;
  if(directory!==element.value){directory=element.value;clearReview();element.closest('[data-folder-review-panel]')?.querySelector('[data-folder-plan]')?.remove();}
  const plan=element.closest('[data-folder-review-panel]')?.querySelector('[data-action="website-files-folder-plan"]');if(plan)plan.disabled=!directory.trim()||!current();return true;
 },async action(op){
  const scope=pin(),ticket=epoch;
  if(op==='choose'){
   if(!native)return true;
   const result=await command('choose',{path:directory},scope);
   if(ticket!==epoch||!matches(scope)||result.cancelled||!result.folder)return true;
   if(result.folder!==directory){clearReview();directory=result.folder;}render();focus('[data-action="website-files-folder-plan"]');
  }else if(op==='plan'){
   if(!current()||!directory.trim())return true;
   clearReview();const active=epoch;render();
   const selected=await command('plan',{directory},scope);
   if(active!==epoch||!matches(scope))return true;
   if(!hash(selected.currentReviewId))throw Error(msg('confirmRequired'));
   if(!await readPage(scope,selected.id,0,active))return true;
   review={scope,id:selected.id,currentReviewId:selected.currentReviewId};directory=page.directory;render();focus('[data-folder-heading]');
  }else if(/^conflict-\d+$/.test(op)){
   const index=Number(op.slice(9));if(!review||!matches(review.scope)||page?.files[index]?.kind!=='conflict')return true;
   const target=page.offset+index,at=Math.floor(target/windowSize)*windowSize;
   if(at<page.offset||Math.min(at+windowSize,page.total)>page.offset+page.files.length){if(!await readPage(scope,review.id,at,ticket))return true;}else offset=at;
   render();const details=document.querySelectorAll('[data-folder-plan] .website-folder-files details')[target-at];
   if(details){details.open=true;requestAnimationFrame(()=>details.querySelector('summary').focus());}
  }else if(op==='previous'||op==='next'){
   if(!review||!page||!matches(review.scope))return true;
   const at=op==='next'?offset+windowSize:Math.max(0,offset-windowSize);if(at>=page.total)return true;
   if(at<page.offset||Math.min(at+windowSize,page.total)>page.offset+page.files.length){if(!await readPage(scope,review.id,at,ticket))return true;}else offset=at;
   render();focus('[data-folder-list]');
  }else if(op==='apply'){
   if(!ready()||acknowledged!==review)throw Error(msg('confirmRequired'));
   const id=review.id;acknowledged=null;render();
   try{await command('apply',{id,reviewed:true},scope);if(ticket===epoch&&matches(scope))await readPage(scope,id,0,ticket);}
   catch(error){clearReview();throw error;}
   finally{render();focus('[data-folder-heading]');}
  }else return false;
  return true;
 }};
}
