import {websiteLayerAt} from './website-layer-model.js';

const hex=bytes=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
async function fingerprint(node){return node?hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(node.outerHTML))):null;}

// Review requests, decisions and element comments for the saved edition.
// Comment context comes from the current page; nothing copied from the page
// is stored, so changed permissions apply to what a reviewer sees here too.
export function websiteFilesReview({request,site,esc,tr,signal,document:pageDocument,selection,locate}){
 let value=null,error=null,ticket=0,changes=new Map(),drift=new Map(),draft={note:'',reviewers:'',comment:'',decision:''};
 const pin=()=>({siteId:site().site.id,expectedRevision:site().site.revision,path:site().path});
 const lang=()=>document.documentElement.lang||undefined;
 const date=at=>new Date(at).toLocaleString(lang());
 const who=actor=>actor.kind==='user'?actor.label:tr('reviewWorkspaceAuthor');
 const button=(key,op,extra='')=>'<button type="button" class="button" data-action="website-files-review-'+op+'" '+extra+'>'+esc(tr(key))+'</button>';
 const field=(key,name,control)=>'<label>'+esc(tr(key))+control.replace('>',' data-review-field="'+name+'">')+'</label>';
 function status(){
  const current=value.requests.find(row=>!row.closed&&!row.stale);
  const key=value.approved?'reviewStatusApproved':current?.state==='changes'?'reviewStatusChanges':current?'reviewStatusOpen':'reviewStatusNone';
  return '<p role="status" data-review-status>'+esc(tr(key))+'</p>'+(value.settings.requireApproval&&!value.approved?'<p class="hint">'+esc(tr('reviewGateHint'))+'</p>':'');
 }
 function settings(){
  return '<label class="website-inline-check"><input type="checkbox" data-review-field="requireApproval"'+(value.settings.requireApproval?' checked':'')+'>'+esc(tr('reviewRequireApproval'))+'</label>';
 }
 function requestForm(){
  return '<details class="website-team-review-request"'+(value.requests.some(row=>!row.closed&&!row.stale)?'':' open')+'><summary>'+esc(tr('reviewRequestTitle'))+'</summary>'+
   field('reviewNote','note','<textarea maxlength="2000" rows="3"></textarea>').replace('</textarea>',esc(draft.note)+'</textarea>')+
   field('reviewReviewers','reviewers','<input maxlength="400" value="'+esc(draft.reviewers)+'">')+button('reviewRequest','request')+'</details>';
 }
 function requestRow(row){
  const decisions=row.decisions.map(d=>'<li>'+esc(tr(d.decision==='approved'?'reviewApprovedBy':'reviewChangesBy',{name:who(d.by),time:date(d.at)}))+(d.note?' — '+esc(d.note):'')+'</li>').join('');
  const open=!row.closed&&!row.stale,diff=changes.get(row.id);
  const paths=diff?.changes?['changed','added','removed'].filter(kind=>diff.changes.counts[kind]).map(kind=>'<p><strong>'+esc(tr('releasePaths_'+kind,{count:diff.changes.counts[kind]}))+'</strong> '+diff.changes.samples[kind].map(p=>'<code>'+esc(p)+'</code>').join(', ')+'</p>').join('')||'<p>'+esc(tr('reviewNoChanges'))+'</p>':'';
  return '<li data-review-request="'+esc(row.id)+'"><p><strong>'+esc(tr('reviewState_'+row.state))+'</strong>'+(row.stale?' · <span data-review-stale>'+esc(tr('reviewStale'))+'</span>':'')+' · '+esc(tr('reviewRequestedBy',{name:who(row.by),time:date(row.at)}))+'</p>'+
   (row.note?'<p>'+esc(row.note)+'</p>':'')+(row.reviewers.length?'<p>'+esc(tr('reviewReviewersList',{names:row.reviewers.join(', ')}))+'</p>':'')+
   (decisions?'<ul>'+decisions+'</ul>':'')+
   '<div class="inline-actions">'+(row.stale&&!row.closed?button('reviewShowChanges','changes','data-id="'+esc(row.id)+'"'):'')+
   (open?button('reviewApprove','approve','data-id="'+esc(row.id)+'"')+button('reviewRequestChanges','request-changes','data-id="'+esc(row.id)+'"')+button('reviewWithdraw','withdraw','data-id="'+esc(row.id)+'"'):'')+'</div>'+paths+'</li>';
 }
 function commentRow(row){
  const replies=row.replies.map(r=>'<li><strong>'+esc(who(r.by))+'</strong> · '+esc(date(r.at))+'<p>'+esc(r.body)+'</p></li>').join('');
  const id='data-id="'+esc(row.id)+'"',changed=drift.get(row.id);
  return '<li data-review-comment="'+esc(row.id)+'"'+(row.resolved?' data-resolved':'')+'><p><strong>'+esc(who(row.by))+'</strong> · '+esc(date(row.at))+' · '+esc(tr('reviewOnElement',{tag:row.anchor.tag}))+
   (changed==='missing'?' · '+esc(tr('reviewAnchorMissing')):changed==='changed'?' · '+esc(tr('reviewAnchorChanged')):'')+'</p><p>'+esc(row.body)+'</p>'+
   (replies?'<ul class="website-team-review-replies">'+replies+'</ul>':'')+
   (row.assignee?'<p>'+esc(tr('reviewAssignedTo',{name:row.assignee}))+'</p>':'')+
   (row.resolved?'<p>'+esc(tr('reviewResolvedBy',{name:who(row.resolved.by),time:date(row.resolved.at)}))+'</p>':'')+
   '<div class="inline-actions">'+(changed==='missing'?'':button('reviewShowElement','locate',id+' data-path="'+esc(row.anchor.path)+'"'))+
   (row.resolved?button('reviewReopen','reopen',id):button('reviewResolve','resolve',id))+'</div>'+
   '<details><summary>'+esc(tr('reviewRespond'))+'</summary><label>'+esc(tr('reviewReply'))+'<textarea maxlength="4000" rows="2" data-review-reply="'+esc(row.id)+'"></textarea></label>'+button('reviewSendReply','reply',id)+
   '<label>'+esc(tr('reviewAssignee'))+'<input maxlength="120" data-review-assignee="'+esc(row.id)+'" value="'+esc(row.assignee??'')+'"></label>'+button('reviewAssign','assign',id)+'</details></li>';
 }
 function view(){
  let body;
  if(error)body='<p role="alert">'+esc(error)+'</p>';
  else if(!value)body='<p role="status">'+esc(tr('loading'))+'</p>';
  else{
   const target=selection();
   body=status()+settings()+requestForm()+(value.requests.length?'<section><h3>'+esc(tr('reviewRequests'))+'</h3><ol class="website-team-review-list">'+value.requests.slice(0,8).map(requestRow).join('')+'</ol></section>':'')+
    '<section><h3>'+esc(tr('reviewComments'))+'</h3><p class="hint">'+esc(tr('reviewCommentsHint',{open:value.openOnPage,total:value.openComments}))+'</p>'+
    (target?field('reviewNewComment','comment','<textarea maxlength="4000" rows="3"></textarea>').replace('</textarea>',esc(draft.comment)+'</textarea>')+button('reviewAddComment','comment'):'<p>'+esc(tr('reviewSelectElement'))+'</p>')+
    '<ol class="website-team-review-list">'+value.comments.map(commentRow).join('')+'</ol>'+
    (value.offset||value.next!==null?'<div class="inline-actions">'+button('pageBack','previous',value.offset?'':'disabled')+button('pageForward','next',value.next===null?'disabled':'')+'</div>':'')+'</section>';
  }
  return '<section class="panel website-files-publish website-team-review" data-website-review><h2 tabindex="-1" data-review-heading>'+esc(tr('reviewTitle'))+'</h2>'+body+
   '<div class="inline-actions">'+button('closePreview','close')+'</div></section>';
 }
 async function accept(next){
  value=next;error=null;drift=new Map();
  const doc=pageDocument();
  for(const row of next.comments){
   const node=websiteLayerAt(doc,row.anchor.path);
   drift.set(row.id,!node||node.localName!==row.anchor.tag?'missing':row.anchor.fingerprint&&await fingerprint(node)!==row.anchor.fingerprint?'changed':'same');
  }
 }
 async function call(operation,data={}){
  const result=await request('review/'+operation,{...pin(),offset:value?.offset??0,...data},{signal:signal()});
  if(result.revision!==site()?.site.revision)return null;
  await accept(result);return result;
 }
 async function open(){
  const active=++ticket;value=null;error=null;changes=new Map();
  try{const next=await request('review/read',pin(),{signal:signal()});if(active===ticket&&next.revision===site()?.site.revision)await accept(next);}
  catch(reason){if(active===ticket&&reason.name!=='AbortError')error=reason.message;}
 }
 function input(element){
  const name=element.dataset.reviewField;if(!name||!value)return false;
  if(name==='requireApproval')return call('settings',{requireApproval:element.checked});
  draft[name]=element.value;return true;
 }
 async function action(op,element){
  const id=element?.dataset.id;
  if(op==='request'){await call('request',{note:draft.note,reviewers:draft.reviewers.split(',').map(name=>name.trim()).filter(Boolean)});draft.note=draft.reviewers='';}
  else if(op==='approve'||op==='request-changes'){await call('decide',{id,decision:op==='approve'?'approved':'changes',note:''});}
  else if(op==='withdraw')await call('withdraw-request',{id});
  else if(op==='changes'){changes.set(id,await request('review/changes',{...pin(),id},{signal:signal()}));}
  else if(op==='comment'){
   const path=selection(),node=path&&websiteLayerAt(pageDocument(),path);
   if(!node||!draft.comment.trim()){document.querySelector('[data-review-field="comment"]')?.focus();return;}
   await call('comment',{anchor:{path,tag:node.localName,fingerprint:await fingerprint(node)},body:draft.comment});draft.comment='';
  }
  else if(op==='reply'){
   const body=document.querySelector('[data-review-reply="'+CSS.escape(id)+'"]')?.value??'';
   if(!body.trim())return;await call('reply',{id,body});
  }
  else if(op==='assign')await call('assign',{id,assignee:document.querySelector('[data-review-assignee="'+CSS.escape(id)+'"]')?.value??''});
  else if(op==='resolve'||op==='reopen')await call(op,{id});
  else if(op==='locate'){locate(element.dataset.path);return 'left';}
  else if(op==='next'||op==='previous'){
   const offset=op==='next'?value.next:Math.max(0,value.offset-40);
   await accept(await request('review/read',{...pin(),offset},{signal:signal()}));
  }
 }
 return {view,open,input,action,reset(){ticket++;value=null;error=null;changes=new Map();draft={note:'',reviewers:'',comment:'',decision:''};},
  focus(){requestAnimationFrame(()=>document.querySelector('[data-review-heading]')?.focus({preventScroll:true}));}};
}
