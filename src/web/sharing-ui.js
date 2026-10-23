import {sharedFigureControls,mountSharedFigures} from './shared-figure-reader.js';
import {t} from './i18n/index.js';
import {recordRevisionView} from './record-revision-view.js';
import {sharingFonts} from './sharing-fonts.js';
import {sharingStructure} from './sharing-structure.js';
import {sharingConfigurationUI} from './sharing-configuration-ui.js';
const tr=(key,values)=>t('sharing',key,values);

export async function sharingUI({state,api,esc,field,showDialog,notify,render,onUpdated=async()=>{}}){
 let snapshot,organizations,busy=false,edited=false,disposed=false,review=null,refreshGeneration=0;const previewFonts=sharingFonts();let figureReaders=[];
 const clearFigures=()=>{for(const reader of figureReaders)reader.dispose();figureReaders=[];};
 const dialogElement=document.querySelector('#dialog');dialogElement?.addEventListener('close',clearFigures);
 const context=state.storage.contextId,workspaceId=state.book.id,current=()=>!disposed&&state.storage?.contextId===context&&state.book?.id===workspaceId;
 const call=async(operation,data={},options={})=>{if(!current())throw Error(tr('workspaceChanged'));const result=await api('/api/sharing/'+operation,{workspaceId,...data},options);if(!current())throw Error(tr('workspaceChanged'));return result;};
 const configurations=sharingConfigurationUI({esc,current,load:(data,options)=>call('configuration',data,{...options,adopt:false})});
 const button=(key,action,attrs='')=>'<button type="button" class="button" data-action="module-command" data-command="sharing-'+action+'" '+attrs+'>'+esc(tr(key))+'</button>';
 const close=()=>{clearFigures();configurations.stop();previewFonts.clear();const dialog=document.querySelector('#dialog');if(dialog?.querySelector('[data-sharing-form],[data-sharing-comparison]'))dialog.close();edited=false;};
 async function refresh(){const generation=++refreshGeneration,values=await Promise.all([call('state'),api('/api/organizations/state',{workspaceId})]);if(current()&&generation===refreshGeneration)[snapshot,organizations]=values;}
 function form(kind,title,body,submitKey,attrs=''){
  clearFigures();configurations.stop();edited=false;showDialog('<form data-module-form data-sharing-form="'+kind+'" '+attrs+'><h2 id="dialog-title">'+esc(tr(title))+'</h2>'+body+'<p role="alert" data-sharing-error></p><div class="dialog-actions">'+button('cancel','close')+(submitKey?'<button class="button primary" type="submit">'+esc(tr(submitKey))+'</button>':'')+'</div></form>');
 }
 function files(direction){const items=snapshot.packages.filter(p=>p.direction===direction);return items.length?'<section><h3>'+esc(tr(direction==='outgoing'?'outgoing':'incomingFiles'))+'</h3><ul>'+items.map(p=>{
  let action=direction==='outgoing'?'<a class="button" href="/api/sharing/download/'+p.id+'?context='+encodeURIComponent(context)+'" download>'+esc(tr('download'))+'</a>':button(p.update?'reviewUpdate':p.kind==='offer'?'copy':'review',p.update||p.kind==='changes'?'review':'copy','data-id="'+p.id+'"');
  if(p.receipt)action='<p>'+esc(tr('reviewReceipt',p.receipt))+'</p>';
  else if(p.obsolete)action='<p>'+esc(tr('alreadyCurrent'))+'</p>';
  return '<li><p><strong>'+esc(tr(p.kind==='offer'?'offer':'return'))+'</strong> · '+esc(p.createdAt)+'<br>'+p.notebooks.map(n=>esc(n.title)).join(', ')+'</p>'+action+'</li>';
 }).join('')+'</ul></section>':'';}
 function view(){
  if(!snapshot)return '';
  return '<section class="panel shared-research"><h2>'+esc(tr('title'))+'</h2><p>'+esc(tr('intro'))+'</p><p>'+esc(tr('offline'))+'</p><div class="module-actions">'+button('contact','contact')+button('receive','receive')+button('refresh','refresh')+(organizations.organizations.some(o=>o.role==='administrator')?button('grant','grant'):'')+'</div>'+(snapshot.working?'<section><h3>'+esc(tr('working'))+'</h3><p>'+esc(tr(snapshot.working.role))+'</p>'+(snapshot.working.role==='editor'?button('changes','changes'):'')+'</section>':'')+snapshot.grants.filter(g=>g.active).map(g=>{
   const org=organizations.organizations.find(o=>o.id===g.organizationId),recipient=g.recipient.kind==='team'?org?.teams.find(t=>t.id===g.recipient.id)?.name:org?.members.find(m=>m.principalId===g.recipient.id)?.name;
   return '<article><h3>'+esc(recipient??'')+'</h3><p>'+esc(tr(g.role))+' · '+g.scopes.map(s=>esc((s.kind==='notebook'?snapshot.notebooks:snapshot.projects).find(n=>n.id===s.id)?.title??'')).join(', ')+'</p><div class="module-actions">'+button('prepare','prepare','data-id="'+g.id+'"')+button('editGrant','edit-grant','data-id="'+g.id+'"')+button('revoke','revoke','data-id="'+g.id+'"')+'</div></article>';
  }).join('')+files('outgoing')+files('incoming')+'</section>';
 }
 function grantForm(organizationId,grant=null){
  const admins=organizations.organizations.filter(o=>o.role==='administrator'),org=admins.find(o=>o.id===organizationId)??admins[0];if(!org){notify(tr('noOrganization'));return;}
  form('grant','grant',field(tr('organization'),'<select name="organization" data-sharing-organization>'+admins.map(o=>'<option value="'+o.id+'" '+(o.id===org.id?'selected':'')+'>'+esc(o.name)+'</option>').join('')+'</select>')+field(tr('recipient'),'<select name="recipient">'+org.members.filter(m=>m.active).map(m=>'<option value="member:'+m.principalId+'">'+esc(m.name)+'</option>').join('')+org.teams.map(team=>'<option value="team:'+team.id+'">'+esc(team.name)+'</option>').join('')+'</select>')+'<fieldset><legend>'+esc(tr('projects'))+'</legend><p>'+esc(tr('projectScope'))+'</p>'+snapshot.projects.map(p=>'<label class="checkbox"><input type="checkbox" name="projects" value="'+p.id+'">'+esc(p.title)+'</label>').join('')+'</fieldset><fieldset><legend>'+esc(tr('books'))+'</legend>'+snapshot.notebooks.map(n=>'<label class="checkbox"><input type="checkbox" name="books" value="'+n.id+'">'+esc(n.title)+'</label>').join('')+'</fieldset>'+field(tr('role'),'<select name="role"><option value="reader">'+esc(tr('reader'))+'</option><option value="editor">'+esc(tr('editor'))+'</option></select>'),'save');
  if(grant){
   const f=document.querySelector('[data-sharing-form="grant"]');f.dataset.id=grant.id;
   f.querySelector('h2').textContent=tr('editGrant');f.elements.organization.disabled=true;
   f.elements.recipient.value=grant.recipient.kind+':'+grant.recipient.id;f.elements.role.value=grant.role;
   for(const scope of grant.scopes){const input=f.querySelector('[name="'+(scope.kind==='project'?'projects':'books')+'"][value="'+scope.id+'"]');if(input)input.checked=true;}
   const help=document.createElement('p');help.textContent=tr('editGrantHelp');f.querySelector('h2').after(help);
  }
 }
 function reviewForm(){form('apply',review.kind==='offer'?'reviewUpdate':'review','<p>'+esc(tr(review.kind==='offer'?'updateHelp':'reviewHelp'))+'</p>'+sharingStructure(review.structure,esc)+(review.rows.length?review.rows.map(row=>'<section><h3>'+esc(row.title)+'</h3><p>'+esc(tr(row.kind))+(row.conflict?' · <strong>'+esc(tr('conflict'))+'</strong>':'')+' · '+esc(tr('evidence',{count:row.evidence}))+'</p>'+field(tr('status'),'<select name="choice-'+row.id+'" required><option value="">'+esc(tr('undecided'))+'</option><option value="incoming">'+esc(tr('incoming'))+'</option><option value="current">'+esc(tr('current'))+'</option></select>')+button('compare','compare','data-id="'+row.id+'"')+'</section>').join(''):'<p>'+esc(tr('emptyReview'))+'</p>'),'apply');for(const row of review.rows)if(row.choice)document.querySelector('[name="choice-'+row.id+'"]').value=row.choice;configurations.mount(document.querySelector('[data-sharing-form="apply"]'),review.id);}
 function error(e){if(!current())return;const el=document.querySelector('[data-sharing-error]');if(el)el.textContent=e.message;else notify(e.message,true);}
 async function action(command,node){
  if(!command?.startsWith('sharing-')||busy)return;busy=true;
  try{
   const op=command.slice(8),id=node.dataset.id;
   if(op==='close'){close();return;}
   if(op==='refresh'){await refresh();render();return;}
   if(op==='contact'){const {contact}=await call('contact'),url=URL.createObjectURL(new Blob([JSON.stringify(contact)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='contact.observanda-sharing-contact';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
   if(op==='grant'){grantForm();return;}
   if(op==='edit-grant'){const grant=snapshot.grants.find(g=>g.id===id);if(!grant)return;grantForm(grant.organizationId,grant);return;}
   if(op==='prepare'){form('offer','prepare','<p>'+esc(tr('contactHelp'))+'</p>'+field(tr('contactFile'),'<input name="contact" type="file" accept=".observanda-sharing-contact,.json" required>'),'prepare','data-id="'+id+'"');return;}
   if(op==='revoke'){const grant=snapshot.grants.find(g=>g.id===id),{generation,...command}=grant;void generation;await call('grant',{command:{...command,workspaceId,expectedRevision:snapshot.revision,active:false}});await refresh();await onUpdated();render();notify(tr('revoked'));return;}
   if(op==='receive'){form('receive','receive','<p>'+esc(tr('enrollmentFirst'))+'</p>'+field(tr('file'),'<input name="file" type="file" accept=".observanda-share" required>'),'inspect');return;}
   if(op==='copy'){form('copy','copy','<p>'+esc(tr('copyHelp'))+'</p>'+field(tr('destination'),'<input name="destination" id="sharing-destination" required autocomplete="off">')+'<button class="button" type="button" data-action="storage-browse" data-target="sharing-destination">'+esc(tr('browse'))+'</button>','copy','data-id="'+id+'"');return;}
   if(op==='changes'){await call('changes');await refresh();render();notify(tr('ready'));return;}
   if(op==='review'){review=await call('review',{id});if(review.receipt){await refresh();render();notify(tr('reviewReceipt',{...review.receipt,accepted:review.receipt.accepted.length,kept:review.receipt.kept.length}));return;}reviewForm();return;}
   if(op==='back'){reviewForm();return;}
   if(op==='compare'){
    for(const row of review.rows)row.choice=document.querySelector('[name="choice-'+row.id+'"]')?.value??row.choice;
    const versions=await Promise.all(['base','incoming','current'].map(version=>call('record',{reviewId:review.id,recordId:id,version})));
    const fileUrl=(version,kind,item)=>'/api/sharing/reviews/'+review.id+'/'+version+'/'+id+'/'+kind+'/'+item+'?context='+encodeURIComponent(context);
    previewFonts.clear();for(const [i,version] of versions.entries())await previewFonts.add(version.fonts,item=>fileUrl(['base','incoming','current'][i],'font',item));if(!current())return;
    clearFigures();configurations.stop();showDialog('<section data-sharing-comparison><h2 id="dialog-title">'+esc(tr('compare'))+'</h2>'+versions.map(({record,materials},i)=>{const version=['base','incoming','current'][i];return '<details data-sharing-figure-version="'+version+'" '+(i===1?'open':'')+'><summary>'+esc(tr(['base','incomingVersion','currentVersion'][i]))+'</summary>'+(record?'<h3>'+esc(record.title)+'</h3>'+recordRevisionView(record,esc,{assetUrl:item=>fileUrl(version,'media',item),figureSources:false,retainedFigureAction:sharedFigureControls(esc)}):'<p>'+esc(tr('absent'))+'</p>')+'<ul>'+materials.map(m=>'<li><strong>'+esc(m.title)+'</strong>'+ (m.kind==='artifact'?'<p>'+esc(m.sourcePath??m.name)+' · '+m.size+' B</p><code>'+esc(m.sha256)+'</code><p><a class="button" href="'+fileUrl(version,'artifact',m.id)+'" download>'+esc(tr('downloadEvidence'))+'</a></p>':'<p><code>'+esc(m.revision)+'</code></p>')+'</li>').join('')+'</ul></details>';}).join('')+'<div class="dialog-actions">'+button('back','back')+'</div></section>');
    for(const [i,value]of versions.entries())if(value.record){const version=['base','incoming','current'][i],selector={reviewId:review.id,recordId:id,version,revision:value.revision},host=document.querySelector('[data-sharing-figure-version="'+version+'"]');figureReaders.push(mountSharedFigures(host,{selector,request:(data,options)=>call('figure',data,{...options,adopt:false}),downloadURL:data=>'/api/sharing/figures/'+data.reviewId+'/'+data.version+'/'+data.recordId+'/'+data.figureId+'?context='+encodeURIComponent(context)+'&revision='+data.revision+'&expectedRevision='+data.expectedRevision+'&format='+data.format}));}return;
   }
  }catch(e){error(e);}finally{busy=false;}
 }
 function input(element){if(!element.closest('[data-sharing-form]'))return false;edited=true;if(element.hasAttribute('data-sharing-organization'))grantForm(element.value);return true;}
 async function submit(formElement,data){
  const kind=formElement.dataset.sharingForm;if(!kind||busy)return;busy=true;formElement.dataset.busy='true';const controls=[...formElement.elements].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
  try{
   let message='updated';
   if(kind==='grant'){const books=data.getAll('books'),projects=data.getAll('projects');if(!books.length&&!projects.length)throw Error(tr('scopeRequired'));const [recipientKind,recipientId]=data.get('recipient').split(':');await call('grant',{command:{workspaceId,expectedRevision:snapshot.revision,id:formElement.dataset.id??null,organizationId:formElement.elements.organization.value,scopes:[...projects.map(id=>({kind:'project',id})),...books.map(id=>({kind:'notebook',id}))],recipient:{kind:recipientKind,id:recipientId},role:data.get('role'),active:true}});}
   if(kind==='offer'){const file=data.get('contact');if(!file?.size||file.size>65536)throw Error(tr('invalidFile'));let contact;try{contact=JSON.parse(await file.text());}catch{throw Error(tr('invalidFile'));}await call('offer',{grantId:formElement.dataset.id,contact});message='ready';}
   if(kind==='receive'){const response=await fetch('/api/sharing/receive',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Observanda-Workspace':context},body:data.get('file')});const result=await response.json();if(!response.ok)throw result;if(!current())throw Error(tr('workspaceChanged'));message='received';}
   if(kind==='copy'){const result=await call('copy',{id:formElement.dataset.id,destination:data.get('destination')});close();notify(tr('created',{path:result.path}));return;}
   if(kind==='apply'){await call('apply',{reviewId:review.id,choices:review.rows.map(row=>({id:row.id,choice:data.get('choice-'+row.id)}))});message='accepted';}
   try{await refresh();if(kind==='grant')await onUpdated();busy=false;close();render();notify(tr(message));}catch{busy=false;close();notify(tr('savedRefreshFailed'),true);}
  }catch(e){error(e);}finally{busy=false;delete formElement.dataset.busy;controls.forEach(([el,disabled])=>el.disabled=disabled);}
 }
 await refresh();return {view,action,input,submit,isDirty:()=>edited,activate:async()=>{if(!busy&&!edited)await refresh();},deactivate:close,dispose(){disposed=true;dialogElement?.removeEventListener('close',clearFigures);close();},discard:close,async save(){const f=document.querySelector('[data-sharing-form]');if(f?.reportValidity())await submit(f,new FormData(f));}};
}
