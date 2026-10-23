import {t} from './i18n/index.js';
import {mountRichText} from './vendor/rich-text-editor.js';
import {setOnlineDetail} from './online-details-model.js';
import {textTools} from './text-tools.js';
import {renderProse} from './prose-model.js';
import {mountOnlineRecordReader} from './online-record-reader.js';
import {applyRichTextStyles} from './rich-text-stylesheet.js';
import {onlineStepBatch} from './online-step-batch.js';
import {onlineRecordDetails} from './online-record-details.js';
import {onlineRelationships} from './online-relationships.js';
import {onlineAttempts} from './online-attempts.js';
import {onlineEvidence} from './online-evidence.js';
const tr=(key,values)=>t('online',key,values);

// This owner keeps the shared editor mounted while polling. Background updates
// never rerender its selection, local undo history or unfinished text.
export function onlineRoom({call,connectionId,context,esc,notify}){
 // Each mounted room has a distinct authoring session, including duplicated
 // tabs. Recovery discovers previous sessions without sharing their identity.
 const sessionKey='observanda.live.client.'+connectionId,clientId=crypto.randomUUID();sessionStorage.setItem(sessionKey,clientId);let root=null,editor=null,timer=null,closed=false,closing=false,running=false,record=null,field='body',epoch=null,initial=null,recovery=null,recoveries=[],conflict=false,draftFailure=false,saveChain=Promise.resolve(),generation=0,draftRequested=0,draftSaved=0,draftDocument=null,draftSaving=false,hasDraft=false,connected=true,accessLost=false,commentsBefore=null;
 const comments=new Map();
 const formRequests=new WeakMap();let details=null,relationships=null,attempts=null,evidence=null,recordReader=null;
 const remote=(operation,data={})=>call('request',{connectionId,operation,data});
 const draft=(extra={})=>call('draft',{connectionId,recordId:record.id,field,clientId,...extra});
 const btn=(key,action)=>'<button type="button" class="button" data-online-room="'+action+'">'+esc(tr(key))+'</button>';
 const fileUrl=(kind,id,revision)=>'/api/live/files/'+connectionId+'/'+record.id+'/'+kind+'/'+id+'?context='+encodeURIComponent(context)+(kind==='artifact'&&revision?'&artifactRevision='+encodeURIComponent(revision):'');
 const figureURL=selector=>'/api/live/figures/'+connectionId+'/'+selector.recordId+'/'+selector.figureId+'?context='+encodeURIComponent(context)+'&selection='+encodeURIComponent(JSON.stringify(selector));
 const pending=()=>!!editor?.collaboration?.steps.length;
 const formDirty=form=>!form.hidden&&!!form.elements.text.value.trim();
 const pendingForms=()=>root?[...root.querySelectorAll('[data-live-comment]')].filter(formDirty):[];
 function status(key,values){const node=root?.querySelector('[data-live-status]');if(node)node.textContent=tr(key,values);}
 function retain(document){
  if(document===null&&!hasDraft&&!draftFailure&&draftSaved===draftRequested)return;hasDraft=document!==null;draftDocument=document;draftRequested++;
  if(draftSaving)return;draftSaving=true;const savedRecord=record.id,savedField=field;
  saveChain=(async()=>{try{while(draftSaved<draftRequested){const version=draftRequested,value=draftDocument;await call('draft',{connectionId,recordId:savedRecord,field:savedField,clientId,document:value,title:record.title,fieldTitle:field==='body'?tr('body'):record.sections.find(s=>'section:'+s.id===field)?.title??''});draftSaved=version;}draftFailure=false;if(!connected)status(accessLost?'denied':'offline');}catch(error){draftFailure=true;status('draftFailed');throw error;}finally{draftSaving=false;}})();void saveChain.catch(()=>{});
 }

 async function deny(){
  accessLost=true;connected=false;conflict=true;clearInterval(timer);
  const local=editor?.doc;if(pending()){recovery={document:local};retain(local);}
  editor?.destroy();editor=null;if(local)root.querySelector('[data-live-writing]').innerHTML='<div class="prose">'+renderProse(local)+'</div>';
  details?.setReadOnly();relationships?.setReadOnly();attempts?.setReadOnly();evidence?.setReadOnly();for(const form of root.querySelectorAll('[data-live-comment]'))form.hidden=true;
  root.querySelector('[data-live-reopen]').hidden=false;recoverView();await saveChain.catch(()=>{});status(draftFailure?'draftFailed':'denied');
 }

 function recoverView(){const host=root?.querySelector('[data-live-recovery]');if(!host)return;host.innerHTML=recovery?'<details open><summary>'+esc(tr('recovered'))+'</summary><p>'+esc(tr('recoveryHelp'))+'</p>'+(recoveries.length>1?'<label>'+esc(tr('draftVersion'))+'<select data-live-recovery-version>'+recoveries.map((d,i)=>'<option value="'+i+'" '+(d===recovery?'selected':'')+'>'+esc(d.savedAt??tr('currentDraft'))+'</option>').join('')+'</select></label>':'')+'<div class="prose">'+renderProse(recovery.document)+'</div>'+btn('restore','restore')+btn('discardDraft','discard')+'</details>':'';if(recovery){applyRichTextStyles(document,recovery.document);host.querySelector('[data-online-room="restore"]').disabled=!editor||conflict;}}
 function mount(){
  editor?.destroy();editor=null;
  const host=root.querySelector('[data-live-writing]');
  if(initial.role==='reader'){host.innerHTML='<p>'+esc(tr('reader'))+'</p><div class="prose">'+renderProse(initial.document)+'</div>';return;}
  host.innerHTML='<div class="document-field"><div class="document-tools">'+textTools({compact:true})+'</div><div class="document-content"></div></div>';
  applyRichTextStyles(document,initial.document);
  editor=mountRichText({mount:host.querySelector('.document-content'),toolbar:host.querySelector('.document-tools'),label:tr('field'),section:{richText:initial.document},collaboration:{version:initial.version,clientId},onError:message=>notify(message,true),onChange:value=>{applyRichTextStyles(document,value);retain(value);status('saving');}});
 }
 async function tick(){
  if(closed||closing||running||!record||conflict)return;running=true;const current=generation;
  try{
   const state=editor?.collaboration??{version:initial.version,steps:[],clientId},steps=onlineStepBatch(state.steps),detailRevision=details?.revision(),linkRevision=relationships?.revision(),attemptRevision=attempts?.revision();
   if(state.steps.length&&!steps.length)throw Object.assign(Error(tr('syncRejected')),{code:'LIMIT'});
   const response=await remote(steps.length?'steps':'document',{recordId:record.id,pagedAttempt:true,field,epoch,version:state.version,clientId,...(steps.length?{steps}:{})});
   if(closed||current!==generation)return;connected=true;
   if(response.role!==initial.role){await deny();return;}
   if(response.details)details?.update(response.details,detailRevision);
   if(response.relations)relationships?.update(response.relations,linkRevision);
   if(Object.hasOwn(response,'attempt'))attempts?.update(response.attempt,response.relations??record.relations,attemptRevision);
   if(response.attemptRevision)attempts?.updateRevision(response.attemptRevision);
   if(response.reset){
    if(pending()){recovery={document:editor.doc};retain(editor.doc);conflict=true;status('changed');root.querySelector('[data-live-reopen]').hidden=false;recoverView();return;}
    initial={...response,role:initial.role};epoch=response.epoch;mount();
   }else if(editor){editor.receive(response.steps,response.clients);if(pending()&&response.steps.length)retain(editor.doc);}
   else if(response.steps.length){const next=await remote('document',{recordId:record.id,pagedAttempt:true,field,clientId});if(closed||current!==generation)return;initial={...next,role:initial.role};epoch=next.epoch;mount();}
   if(!pending()&&!recovery){retain(null);await saveChain;}
   if(!draftFailure)status(pending()?'saving':'saved');
   const presence=root.querySelector('[data-live-presence]');if(presence)presence.textContent=tr('presence',{names:response.presence.join(', ')});
   const discussion=await remote('comments',{recordId:record.id,pagedAttempt:true});if(closed||current!==generation)return;showComments(discussion);
  }catch(error){if(!closed&&current===generation){if(error.code==='COLLABORATION_DENIED'){await deny();return;}connected=false;if(['LIMIT','COLLABORATION_INVALID','INVALID','NOT_FOUND'].includes(error.code)){if(pending()){recovery={document:editor.doc};retain(editor.doc);}conflict=true;root.querySelector('[data-live-reopen]').hidden=false;recoverView();await saveChain.catch(()=>{});status(draftFailure?'draftFailed':'syncRejected');}else status(draftFailure?'draftFailed':draftSaved<draftRequested?'offlinePending':'offline');}}
  finally{running=false;}
 }
 function showComments(page){
  for(const item of page.items)comments.set(item.index,item);
  commentsBefore=comments.size?[...comments.keys()].reduce((a,b)=>Math.min(a,b),Infinity)||null:page.before;
  const host=root?.querySelector('[data-live-comments]');if(!host)return;
  const html=[...comments.values()].sort((a,b)=>a.index-b.index).map(item=>'<article><p><strong>'+esc(item.name)+'</strong> · '+esc(item.at)+'</p><p class="online-comment">'+esc(item.text)+'</p></article>').join('');
  if(host.innerHTML!==html)host.innerHTML=html;
  let more=root.querySelector('[data-online-room="earlier"]');if(!more){host.insertAdjacentHTML('beforebegin',btn('moreComments','earlier'));more=root.querySelector('[data-online-room="earlier"]');}more.hidden=commentsBefore===null;
 }
 async function open(id,nextField='body'){
  if(details?.isDirty()||relationships?.isDirty()||attempts?.isDirty()||evidence?.isDirty()||pendingForms().length){notify(tr('finishForms'),true);return;}if(pending()||draftFailure||draftSaving){notify(tr('keepOpen'),true);return;}
  generation++;clearInterval(timer);editor?.destroy();editor=null;evidence?.dispose();recordReader?.dispose();evidence=null;conflict=false;accessLost=false;comments.clear();commentsBefore=null;const current=generation;
  const value=await remote('read',{recordId:id,pagedAttempt:true});if(closed||current!==generation)return;record=value.record;field=nextField;
  const [snapshot,saved]=await Promise.all([remote('document',{recordId:id,pagedAttempt:true,field,clientId}),draft()]);if(closed||current!==generation)return;
  initial={...snapshot,role:value.role};epoch=snapshot.epoch;recoveries=[...(saved.draft?[saved.draft]:[]),...(saved.others??[])];recovery=recoveries[0]??null;hasDraft=!!saved.draft;
  root.innerHTML='<section class="online-record"><h3>'+esc(record.title)+'</h3><label>'+esc(tr('field'))+'<select data-live-field>'+[{id:'body',title:tr('body')},...record.sections.map(s=>({id:'section:'+s.id,title:s.title}))].map(f=>'<option value="'+esc(f.id)+'" '+(f.id===field?'selected':'')+'>'+esc(f.title)+'</option>').join('')+'</select></label><p role="status" data-live-status></p><p class="muted" data-live-presence></p><div data-live-writing></div><div data-live-reopen hidden>'+btn('reopen','reopen')+'</div><div data-live-recovery></div><details data-live-read></details>'+'<section data-evidence-owner></section><section><h3>'+esc(tr('comments'))+'</h3><div data-live-comments></div>'+(value.role==='editor'?'<form data-live-comment><label>'+esc(tr('comment'))+'<textarea name="text" required maxlength="10000"></textarea></label><button class="button">'+esc(tr('sendComment'))+'</button></form>':'')+'</section></section>';
  const detailsHost=document.createElement('section');root.querySelector('[data-live-recovery]').after(detailsHost);details?.dispose();
  details=onlineRecordDetails({remote,esc,notify,onChange:values=>{if(root)root.querySelector('.online-record>h3').textContent=values.title;for(const [name,value] of Object.entries(values))setOnlineDetail(record,name,value);}});details.mount(detailsHost,record,value.role);
  recordReader?.dispose();recordReader=mountOnlineRecordReader(root.querySelector('[data-live-read]'),{remote,recordId:record.id,esc,assetUrl:id=>fileUrl('media',id),figureURL});
  const linkHost=document.createElement('section');root.querySelector('[data-live-read]').before(linkHost);relationships?.dispose();
  relationships=onlineRelationships({remote,esc,notify,figureURL,mediaUrl:(owner,id,link)=>'/api/live/files/'+connectionId+'/'+owner+'/media/'+id+'?context='+encodeURIComponent(context)+(link?'&link='+link.linkId+'&revision='+link.revision:'')});relationships.mount(linkHost,record,value.role);
  const attemptHost=document.createElement('section');linkHost.after(attemptHost);attempts?.dispose();
  attempts=onlineAttempts({remote,commands:{pending:()=>call('attempt-pending',{connectionId,recordId:value.record.id}),send:command=>call('append-attempt',{connectionId,command}),acknowledge:id=>call('attempt-acknowledge',{connectionId,recordId:value.record.id,id})},esc,notify,figureURL,fileUrl:(kind,id,ref,trail=[])=>fileUrl(kind,id)+'&attemptKind='+ref.kind+'&attemptId='+ref.id+'&attemptRevision='+ref.revision+'&attemptTrail='+encodeURIComponent(JSON.stringify(trail))});attempts.mount(attemptHost,record,value.role);
  evidence?.dispose();evidence=onlineEvidence({remote,esc,notify,fileUrl,figureURL,retainedFileUrl:(kind,id,ref,trail=[])=>fileUrl(kind,id)+'&evidenceKind='+ref.kind+'&evidenceId='+ref.id+'&evidenceRevision='+ref.revision+'&evidenceTrail='+encodeURIComponent(JSON.stringify(trail))});evidence.mount(root.querySelector('[data-evidence-owner]'),record.id,value.role);
  mount();recoverView();status('saved');timer=setInterval(()=>void tick(),1000);void tick();return true;
 }
 async function action(event){
  const button=event.target.closest('[data-online-room]');if(!button)return;
  try{
   if(button.dataset.onlineRoom==='reopen'){const local=recovery;editor?.destroy();editor=null;await open(record.id,field);recovery=local;recoverView();}
   if(button.dataset.onlineRoom==='restore'&&editor&&recovery&&!conflict){const previous=recovery;editor.replaceDocument(previous.document);await saveChain;if(previous.clientId&&previous.clientId!==clientId)await draft({clientId:previous.clientId,document:null,expectedRevision:previous.revision});recoveries=recoveries.filter(d=>d!==previous);recovery=recoveries[0]??null;recoverView();}
   if(button.dataset.onlineRoom==='discard'){const previous=recovery;if(previous?.clientId&&previous.clientId!==clientId)await draft({clientId:previous.clientId,document:null,expectedRevision:previous.revision});else {retain(null);await saveChain;}recoveries=recoveries.filter(d=>d!==previous);recovery=recoveries[0]??null;recoverView();}
   if(button.dataset.onlineRoom==='earlier'&&commentsBefore!==null){const current=generation;button.disabled=true;try{const page=await remote('comments',{recordId:record.id,pagedAttempt:true,before:commentsBefore});if(!closed&&current===generation)showComments(page);}finally{button.disabled=false;}}
  }catch(error){notify(error.message,true);}
 }
 async function saveForm(form){
  if(!form.reportValidity())throw Error(tr('finishForms'));const value=form.elements.text.value,previous=formRequests.get(form);
  // Keep the same command across a lost response. A retry must settle the
  // original operation before the user submits different contents.
  if(previous&&previous.value!==value)throw Error(tr('retryForm'));
  const request=previous??{value,operation:'comment',data:{recordId:record.id,id:crypto.randomUUID(),text:value}};formRequests.set(form,request);
  const controls=[...form.elements].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
  const input=form.elements.text,button=form.querySelector('button');
  try{await remote(request.operation,request.data);formRequests.delete(form);input.readOnly=false;button.textContent=tr('sendComment');form.reset();}
  catch(error){if(['RECORD_CHANGED','INVALID','COLLABORATION_INVALID','COLLABORATION_DENIED','CONFLICT'].includes(error.code)){formRequests.delete(form);input.readOnly=false;button.textContent=tr('sendComment');}else{input.readOnly=true;button.textContent=tr('retrySend');}throw error;}
  finally{controls.forEach(([el,disabled])=>el.disabled=disabled);}
 }
 async function submit(event){if(!event.target.matches('[data-live-comment]'))return;event.preventDefault();event.stopPropagation();try{await saveForm(event.target);await tick();}catch(error){notify(error.message,true);}}
 return {
  attach(host){root=host;root.addEventListener('click',action);root.addEventListener('submit',submit);root.addEventListener('change',event=>{if(event.target.matches('[data-live-recovery-version]')){recovery=recoveries[Number(event.target.value)]??null;recoverView();}if(event.target.matches('[data-live-field]')){const selected=event.target.value;event.target.value=field;void open(record.id,selected).catch(e=>notify(e.message,true));}});},open,
  isDirty:()=>pending()||draftFailure||draftSaving||details?.isDirty()||relationships?.isDirty()||attempts?.isDirty()||evidence?.isDirty()||!!pendingForms().length,
  async save(){if(details?.isDirty())await details.save();if(relationships?.isDirty())await relationships.save();if(attempts?.isDirty())await attempts.save();if(evidence?.isDirty())await evidence.save();for(const form of pendingForms())await saveForm(form);},
  async close({discardForms=false}={}){if(closed)return;if(details?.isBusy()||relationships?.isBusy()||attempts?.isBusy()||evidence?.isBusy())throw Error(tr('detailsSaving'));if(!discardForms&&(details?.isDirty()||relationships?.isDirty()||attempts?.isDirty()||evidence?.isDirty()||pendingForms().length))throw Error(tr('finishForms'));closing=true;generation++;clearInterval(timer);root.inert=true;try{if(pending())retain(editor.doc);await saveChain;closed=true;details?.dispose();relationships?.dispose();attempts?.dispose();evidence?.dispose();recordReader?.dispose();editor?.destroy();editor=null;}finally{closing=false;root.inert=false;if(!closed&&!conflict)timer=setInterval(()=>void tick(),1000);}}
 };
}
