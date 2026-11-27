// Agent keys: the owner lets programs on this computer, from any provider, use
// this workspace through the agent API. The Agents settings page lists the keys,
// creates them, shows how programs connect and what agents changed. A new key is
// shown once, in a dialog, and is never kept by the page.
import './i18n/catalogues/agentKeys.js';
import {t} from './i18n/index.js';
export function agentKeysUI({api,esc,field,present,notify,render}){
 const text=(key,args)=>esc(t('agentKeys',key,args));
 let keys=[],activity=[],projects=[],books=new Map(),endpointFile='',loaded=false,failure='',generation=0;
 // The new key leaves the page as soon as its dialog closes, however it is closed.
 function forgetKey(){for(const secret of document.querySelectorAll('[data-agent-key-secret]')){secret.value='';secret.textContent='';secret.remove();}}
 const day=value=>new Date(value).toLocaleDateString();
 async function loadProjects(found,parentId=null,depth=0){
  for(let offset=0;found.length<500;){
   const page=await api('/api/projects/list',{parentId,offset,limit:50,revision:null},{adopt:false});
   for(const project of page.projects){found.push({id:project.projectId,title:project.summary.title,depth});await loadProjects(found,project.projectId,depth+1);}
   offset+=page.projects.length;if(!page.projects.length||offset>=page.total)break;
  }
  return found;
 }
 async function loadBooks(projectId){
  if(books.has(projectId))return books.get(projectId);const items=[];let after=null;
  do{const page=await api('/api/projects/'+projectId+'/lab-books/list',{after,limit:50,revision:null},{adopt:false});items.push(...page.items.map(item=>({id:item.labBookId,title:item.directory})));after=page.next;}while(after&&items.length<500);
  books.set(projectId,items);return items;
 }
 // Reads everything the page shows; a failure is shown on the page with a way to retry.
 async function load(){
  const mine=++generation;
  try{
   const listing=await api('/api/security/agent-keys/list',{}),changes=(await api('/api/security/agent-keys/activity',{})).activity,found=await loadProjects([]);
   if(mine!==generation)return;
   keys=listing.agentKeys;endpointFile=listing.endpointFile;activity=changes;projects=found;books=new Map();
   for(const key of keys)if(key.scope.kind==='lab-book')await loadBooks(key.scope.projectId);
   if(mine===generation){loaded=true;failure='';}
  }catch(error){if(mine===generation){loaded=false;failure=error?.message??'';}}
 }
 function scopeText(scope){
  if(scope.kind==='workspace')return t('agentKeys','scopeWorkspace');
  const project=projects.find(item=>item.id===scope.projectId)?.title??t('agentKeys','unavailable');
  if(scope.kind==='project')return t('agentKeys','scopeProject',{project});
  const book=books.get(scope.projectId)?.find(item=>item.id===scope.labBookId)?.title??t('agentKeys','unavailable');
  return t('agentKeys','scopeLabBook',{project,book});
 }
 const description=()=>location.origin+'/api/v1/openapi.json';
 function connection(){
  return field(text('description'),'<input readonly data-agent-key-description value="'+esc(description())+'">')+'<p class="muted">'+text('descriptionHelp')+'</p>'+
   field(text('endpointFile'),'<input readonly data-agent-endpoint-file value="'+esc(endpointFile)+'">')+'<p class="muted">'+text('endpointFileHelp')+'</p>';
 }
 // The page's panels, inside the settings frame.
 function view(){
  if(!loaded)return '<section class="panel" data-agent-keys-page><h2>'+text('title')+'</h2>'+(failure?'<p role="alert">'+esc(failure)+'</p><button type="button" class="button" data-action="security-agent-keys-retry">'+text('retry')+'</button>':'<p role="status">'+text('loading')+'</p>')+'</section>';
  const list=keys.length?'<ul class="agent-keys" data-agent-keys>'+keys.map(key=>'<li><strong>'+esc(key.name)+'</strong><span>'+esc(scopeText(key.scope))+'</span><span>'+text(key.access==='write'?'accessWrite':'accessRead')+'</span><span>'+(key.expiresAt?text('expires',{date:day(key.expiresAt)}):text('noExpiry'))+'</span><span>'+(key.lastUsedAt?text('lastUsed',{date:day(key.lastUsedAt)}):text('notUsed'))+'</span><button type="button" class="button" data-action="security-agent-key-revoke" data-id="'+esc(key.id)+'" aria-label="'+text('revokeNamed',{name:key.name})+'">'+text('revoke')+'</button></li>').join('')+'</ul>':'<p class="muted" data-agent-keys-empty>'+text('none')+'</p>';
  const scopes='<option value="workspace">'+text('scopeWorkspace')+'</option>'+projects.map(project=>'<option value="project:'+esc(project.id)+'">'+'— '.repeat(project.depth)+esc(project.title)+'</option>').join('');
  const verbs={'lab-books/create':'activityCreateLabBook','records/create':'activityCreate','records/update':'activityUpdate','records/link':'activityLink','records/unlink':'activityUnlink','files/attach':'activityAttach','app/research':'activityResearch','app/website':'activityWebsite','app/pdf':'activityPdf'};
  return '<section class="panel" data-agent-keys-page><h2>'+text('title')+'</h2><p>'+text('help')+'</p>'+list+
   '<h3>'+text('create')+'</h3><form id="security-agent-key-form">'+
   field(text('name'),'<input name="name" required maxlength="80" autocomplete="off" aria-describedby="agent-key-name-hint"><small id="agent-key-name-hint" class="muted">'+text('nameHint')+'</small>')+
   field(text('reaches'),'<select name="scope" data-agent-key-scope>'+scopes+'</select>')+
   '<div data-agent-key-book hidden>'+field(text('labBook'),'<select name="labBook"></select>')+'</div>'+
   field(text('access'),'<select name="access"><option value="read">'+text('accessRead')+'</option><option value="write">'+text('accessWrite')+'</option></select>')+
   field(text('expiry'),'<input name="expiry" type="date">')+
   '<button class="button primary" type="submit">'+text('createButton')+'</button></form></section>'+
   '<section class="panel"><h2>'+text('connectTitle')+'</h2>'+connection()+'</section>'+
   '<section class="panel"><h2>'+text('activityTitle')+'</h2>'+(activity.length?'<ul class="agent-activity" data-agent-activity>'+activity.map(entry=>'<li><time datetime="'+esc(entry.at)+'">'+esc(new Date(entry.at).toLocaleString())+'</time> '+text(verbs[entry.operation],{key:entry.keyName,title:entry.title})+'</li>').join('')+'</ul>':'<p class="muted">'+text('noActivity')+'</p>')+'</section>';
 }
 async function input(el){
  if(!el.matches('[data-agent-key-scope]'))return false;
  const form=el.closest('form'),holder=form.querySelector('[data-agent-key-book]'),select=form.elements.labBook,value=el.value;
  if(!value.startsWith('project:')){holder.hidden=true;select.replaceChildren();return true;}
  const items=await loadBooks(value.slice('project:'.length));if(!form.isConnected||el.value!==value)return true;
  select.innerHTML='<option value="">'+text('allLabBooks')+'</option>'+items.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.title)+'</option>').join('');holder.hidden=false;return true;
 }
 async function action(button){
  const name=button.dataset.action;
  if(name==='security-agent-keys-retry'){await load();render();return true;}
  if(name==='security-agent-key-revoke'){await api('/api/security/agent-keys/revoke',{id:button.dataset.id});notify(t('agentKeys','revoked'));await load();render();return true;}
  if(name==='security-agent-key-done'){forgetKey();document.querySelector('#dialog')?.close();await load();render();return true;}
  return false;
 }
 async function submit(form,data){
  if(form.id!=='security-agent-key-form')return false;
  const choice=String(data.get('scope')),labBookId=String(data.get('labBook')??''),projectId=choice.startsWith('project:')?choice.slice('project:'.length):null;
  const scope=!projectId?{kind:'workspace'}:labBookId?{kind:'lab-book',projectId,labBookId}:{kind:'project',projectId};
  const expiry=String(data.get('expiry')??'');
  const result=await api('/api/security/agent-keys/create',{name:String(data.get('name')).trim(),scope,access:String(data.get('access')),expiresAt:expiry?new Date(expiry+'T23:59:59.999Z').toISOString():null});
  form.reset();form.querySelector('[data-agent-key-book]').hidden=true;
  present(t('agentKeys','createdTitle'),'<p>'+text('shownOnce')+'</p>'+field(text('key'),'<textarea data-agent-key-secret readonly rows="2" spellcheck="false" class="security-fingerprint">'+esc(result.key)+'</textarea>')+connection(),
   '<button type="button" class="button primary" data-action="security-agent-key-done">'+text('done')+'</button>');
  document.querySelector('#dialog')?.addEventListener('close',forgetKey,{once:true});
  return true;
 }
 return {load,view,action,submit,input};
}
