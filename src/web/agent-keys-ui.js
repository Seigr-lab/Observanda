// Agent keys: the owner lets programs on this computer, from any provider, use
// this workspace through the agent API. The full key is shown once.
import './i18n/catalogues/agentKeys.js';
import {t} from './i18n/index.js';
export function agentKeysUI({api,esc,field,present,notify}){
 const text=(key,args)=>esc(t('agentKeys',key,args));
 let keys=[],activity=[],projects=[],books=new Map(),created=null,endpointFile='';
 document.querySelector('#dialog')?.addEventListener('close',()=>{created=null;const secret=document.querySelector('[data-agent-key-secret]');if(secret){secret.value='';secret.textContent='';}});
 const day=value=>new Date(value).toLocaleDateString();
 async function loadProjects(parentId=null,depth=0){
  for(let offset=0;projects.length<500;){
   const page=await api('/api/projects/list',{parentId,offset,limit:50,revision:null},{adopt:false});
   for(const project of page.projects){projects.push({id:project.projectId,title:project.summary.title,depth});await loadProjects(project.projectId,depth+1);}
   offset+=page.projects.length;if(!page.projects.length||offset>=page.total)break;
  }
 }
 async function loadBooks(projectId){
  if(books.has(projectId))return books.get(projectId);const items=[];let after=null;
  do{const page=await api('/api/projects/'+projectId+'/lab-books/list',{after,limit:50,revision:null},{adopt:false});items.push(...page.items.map(item=>({id:item.labBookId,title:item.directory})));after=page.next;}while(after&&items.length<500);
  books.set(projectId,items);return items;
 }
 function scopeText(scope){
  if(scope.kind==='workspace')return t('agentKeys','scopeWorkspace');
  const project=projects.find(item=>item.id===scope.projectId)?.title??t('agentKeys','unavailable');
  if(scope.kind==='project')return t('agentKeys','scopeProject',{project});
  const book=books.get(scope.projectId)?.find(item=>item.id===scope.labBookId)?.title??t('agentKeys','unavailable');
  return t('agentKeys','scopeLabBook',{project,book});
 }
 function view(){
  const list=keys.length?'<ul class="agent-keys" data-agent-keys>'+keys.map(key=>'<li><strong>'+esc(key.name)+'</strong><span>'+esc(scopeText(key.scope))+'</span><span>'+text(key.access==='write'?'accessWrite':'accessRead')+'</span><span>'+(key.expiresAt?text('expires',{date:day(key.expiresAt)}):text('noExpiry'))+'</span><span>'+(key.lastUsedAt?text('lastUsed',{date:day(key.lastUsedAt)}):text('notUsed'))+'</span><button type="button" class="button" data-action="security-agent-key-revoke" data-id="'+esc(key.id)+'">'+text('revoke')+'</button></li>').join('')+'</ul>':'<p class="muted" data-agent-keys-empty>'+text('none')+'</p>';
  const scopes='<option value="workspace">'+text('scopeWorkspace')+'</option>'+projects.map(project=>'<option value="project:'+esc(project.id)+'">'+'— '.repeat(project.depth)+esc(project.title)+'</option>').join('');
  const verbs={'records/create':'activityCreate','records/update':'activityUpdate','records/link':'activityLink','records/unlink':'activityUnlink','files/attach':'activityAttach'};
  const changes='<section class="security-section"><h3>'+text('activityTitle')+'</h3>'+(activity.length?'<ul class="agent-activity" data-agent-activity>'+activity.map(entry=>'<li><time datetime="'+esc(entry.at)+'">'+esc(new Date(entry.at).toLocaleString())+'</time> '+text(verbs[entry.operation],{key:entry.keyName,title:entry.title})+'</li>').join('')+'</ul>':'<p class="muted">'+text('noActivity')+'</p>')+'</section>';
  present(t('agentKeys','title'),'<p>'+text('help')+'</p>'+list+changes+
   '<details class="security-section"><summary>'+text('create')+'</summary><form id="security-agent-key-form">'+
   field(text('name'),'<input name="name" required maxlength="80" autocomplete="off" aria-describedby="agent-key-name-hint"><small id="agent-key-name-hint" class="muted">'+text('nameHint')+'</small>')+
   field(text('reaches'),'<select name="scope" data-agent-key-scope>'+scopes+'</select>')+
   '<div data-agent-key-book hidden>'+field(text('labBook'),'<select name="labBook"></select>')+'</div>'+
   field(text('access'),'<select name="access"><option value="read">'+text('accessRead')+'</option><option value="write">'+text('accessWrite')+'</option></select>')+
   field(text('expiry'),'<input name="expiry" type="date">')+
   '<button class="button primary" type="submit">'+text('createButton')+'</button></form></details>');
 }
 async function open(){keys=[];activity=[];projects=[];books=new Map();const listing=await api('/api/security/agent-keys/list',{});keys=listing.agentKeys;endpointFile=listing.endpointFile;activity=(await api('/api/security/agent-keys/activity',{})).activity;await loadProjects();for(const key of keys)if(key.scope.kind==='lab-book')await loadBooks(key.scope.projectId);view();}
 async function input(el){
  if(!el.matches('[data-agent-key-scope]'))return false;
  const form=el.closest('form'),holder=form.querySelector('[data-agent-key-book]'),select=form.elements.labBook,value=el.value;
  if(!value.startsWith('project:')){holder.hidden=true;select.replaceChildren();return true;}
  const items=await loadBooks(value.slice('project:'.length));if(!form.isConnected||el.value!==value)return true;
  select.innerHTML='<option value="">'+text('allLabBooks')+'</option>'+items.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.title)+'</option>').join('');holder.hidden=false;return true;
 }
 async function action(button){
  const name=button.dataset.action;
  if(name==='security-agent-keys'){await open();return true;}
  if(name==='security-agent-key-revoke'){await api('/api/security/agent-keys/revoke',{id:button.dataset.id});notify(t('agentKeys','revoked'));await open();return true;}
  if(name==='security-agent-key-done'){created=null;await open();return true;}
  return false;
 }
 async function submit(form,data){
  if(form.id!=='security-agent-key-form')return false;
  const choice=String(data.get('scope')),labBookId=String(data.get('labBook')??''),projectId=choice.startsWith('project:')?choice.slice('project:'.length):null;
  const scope=!projectId?{kind:'workspace'}:labBookId?{kind:'lab-book',projectId,labBookId}:{kind:'project',projectId};
  const expiry=String(data.get('expiry')??'');
  const result=await api('/api/security/agent-keys/create',{name:String(data.get('name')).trim(),scope,access:String(data.get('access')),expiresAt:expiry?new Date(expiry+'T23:59:59.999Z').toISOString():null});
  created=result.key;
  present(t('agentKeys','createdTitle'),'<p>'+text('shownOnce')+'</p>'+field(text('key'),'<textarea data-agent-key-secret readonly rows="2" spellcheck="false" class="security-fingerprint">'+esc(created)+'</textarea>')+
   field(text('description'),'<input readonly data-agent-key-description value="'+esc(location.origin+'/api/v1/openapi.json')+'">')+'<p class="muted">'+text('descriptionHelp')+'</p>'+
   field(text('endpointFile'),'<input readonly data-agent-endpoint-file value="'+esc(endpointFile)+'">')+'<p class="muted">'+text('endpointFileHelp')+'</p>',
   '<button type="button" class="button primary" data-action="security-agent-key-done">'+text('done')+'</button>');
  return true;
 }
 return {action,submit,input};
}
