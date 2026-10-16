import {t} from './i18n/index.js';
import {organizationActivityUI} from './organization-activity-ui.js';
import {collaborationIdentityActions} from './collaboration-identity-ui.js';
const tr=(key,values)=>t('organizations',key,values);
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function organizationsUI({state,api,esc,field,showDialog,notify,render,onUpdated=async()=>{}}){
  let snapshot=null,pendingFile=null,inspection=null,busy=false,disposed=false,edited=false,generation=0;
  const context=state.storage?.contextId,workspaceId=state.book.id;
  const current=()=>!disposed&&context===state.storage?.contextId&&workspaceId===state.book?.id;
  const button=(key,command,extra='')=>'<button type="button" class="button" data-action="module-command" data-command="organization-'+command+'" '+extra+'>'+esc(tr(key))+'</button>';
  const input=(name,value='',attrs='')=>'<input name="'+name+'" value="'+esc(value)+'" '+attrs+'>';
  const selectRole=role=>field(tr('role'),'<select name="role">'+['member','administrator'].map(value=>'<option value="'+value+'" '+(value===role?'selected':'')+'>'+esc(tr(value))+'</option>').join('')+'</select>');
  const close=()=>{const dialog=document.querySelector('#dialog');if(dialog?.querySelector('[data-organization-form],[data-organization-activity]'))dialog.close();pendingFile=null;inspection=null;edited=false;};
  const showActivity=organizationActivityUI({esc,button,showDialog});
  async function call(operation,data={}){if(!current())throw Error(tr('changed'));const result=await api('/api/organizations/'+operation,{workspaceId,...data});if(!current())throw Error(tr('changed'));return result;}
  async function refresh(){const request=++generation,result=await call('state');if(request===generation)snapshot=result;}
  async function mutate(operation,payload){return call('command',{operation,payload,expectedRevision:snapshot.revision});}
  const org=id=>snapshot.organizations.find(o=>o.id===id);
  const attrs=(organizationId,id='')=>'data-organization="'+organizationId+'" data-id="'+id+'"';
  function form(kind,title,body,extra=''){
    pendingFile=null;inspection=null;edited=false;
    showDialog('<form data-module-form data-organization-form="'+kind+'" '+extra+'><h2 id="dialog-title">'+esc(tr(title))+'</h2>'+body+'<p role="alert" data-organization-error></p><div class="dialog-actions">'+button('close','close')+'<button type="submit" class="button primary">'+esc(tr(['accept','inspect'].includes(kind)?kind:kind==='create'?'create':['receive','receipt'].includes(kind)?'import':'save'))+'</button></div></form>');
  }
  const identityField=()=>field(tr('identityFile'),'<input type="file" name="identity" accept=".observanda-identity,.json" required data-organization-identity>')+'<p data-organization-fingerprint>'+esc(tr('chooseIdentity'))+'</p><label class="checkbox"><input type="checkbox" name="verified" required>'+esc(tr('verified'))+'</label>';
  const fileField=()=>field(tr('file'),'<input type="file" name="file" accept=".observanda-invitation,.observanda-acceptance,.observanda-membership,.json" required>');
  function view(){
    if(!snapshot)return '';
    return '<section class="module-workbench"><h1>'+esc(tr('title'))+'</h1><p>'+esc(tr('intro'))+'</p><p>'+esc(tr('fileWorkflow'))+'</p><div class="module-actions">'+button('create','create')+button('identity','identity')+button('openInvitation','inspect')+button('receive','receive')+button('receipt','receipt')+button('refresh','refresh')+'</div>'+collaborationIdentityActions(esc)+snapshot.organizations.map(o=>'<section class="panel"><h2>'+esc(o.name)+'</h2>'+(o.role==='administrator'?'<div class="module-actions">'+button('rename','rename',attrs(o.id))+button('invite','invite',attrs(o.id))+button('newTeam','team',attrs(o.id))+button('activity','activity',attrs(o.id))+'</div>':'')+'<h3>'+esc(tr('members'))+'</h3>'+o.members.map(m=>'<p>'+esc(m.name)+' — '+esc(tr(m.active?m.role:'inactive'))+' '+(o.role==='administrator'&&m.active?button('edit','member',attrs(o.id,m.principalId)):'')+'</p>').join('')+'<h3>'+esc(tr('teams'))+'</h3>'+o.teams.map(team=>'<p>'+esc(team.name)+' ('+team.members.length+') '+(o.role==='administrator'?button('edit','team',attrs(o.id,team.id))+button('removeTeam','remove-team',attrs(o.id,team.id)):'')+'</p>').join('')+(o.role==='administrator'?'<h3>'+esc(tr('invitations'))+'</h3>'+o.invitations.map(i=>'<p>'+esc(i.name)+' — '+esc(tr(i.status))+' '+(i.status==='pending'?button('downloadInvitation','download-invitation',attrs(o.id,i.id))+button('revoke','revoke',attrs(o.id,i.id)):'')+'</p>').join(''):'')+'</section>').join('')+(!snapshot.organizations.length?'<p>'+esc(tr('empty'))+'</p>':'')+(snapshot.enrollments.length?'<section class="panel"><h2>'+esc(tr('enrollments'))+'</h2><p>'+esc(tr('receiptHelp'))+'</p>'+snapshot.enrollments.map(e=>'<p>'+esc(e.organizationName)+' — '+esc(e.acceptedAt?tr('confirmed',{time:e.acceptedAt}):tr('awaiting'))+'</p>').join('')+'</section>':'')+'</section>';
  }
  async function readFile(file){if(!file||!file.size||file.size>65536)throw Error(tr('invalidFile'));try{return JSON.parse(await file.text());}catch{throw Error(tr('invalidFile'));}}
  function displayError(error){if(!current())return;const node=document.querySelector('[data-organization-error]');if(node)node.textContent=error.message;else notify(error.message,true);}
  async function action(command,node){
    if(!command?.startsWith('organization-')||busy)return;const op=command.slice(13);busy=true;
    try{
      const organization=org(node.dataset.organization),id=node.dataset.id;
      if(op==='close'){close();return;}
      if(op==='activity'){const page=await call('activity',{organizationId:organization.id,before:node.dataset.before?Number(node.dataset.before):null});showActivity(organization,page);return;}
      if(op==='refresh'){await refresh();render();return;}
      if(op==='identity'){download((await call('identity')).identity,'organization.observanda-identity');notify(tr('noSecret'));return;}
      if(op==='download-invitation'){download((await call('invitation',{id})).file,'organization.observanda-invitation');return;}
      if(op==='create')form('create','create',field(tr('name'),input('name','','required maxlength="160"'))+field(tr('administratorName'),input('administratorName','','required maxlength="160"')));
      else if(['inspect','receive','receipt'].includes(op))form(op,op==='inspect'?'openInvitation':op,fileField());
      else if(op==='rename')form('rename','rename',field(tr('name'),input('name',organization.name,'required maxlength="160"')),attrs(organization.id));
      else if(op==='invite')form('invite','invite',field(tr('recipientName'),input('name','','required maxlength="160"'))+identityField()+selectRole('member')+'<p>'+esc(tr('roleHelp'))+'</p>'+field(tr('expires'),'<select name="days"><option value="1">'+esc(tr('day'))+'</option><option value="7">'+esc(tr('week'))+'</option></select>')+'<fieldset><legend>'+esc(tr('teams'))+'</legend>'+organization.teams.map(team=>'<label class="checkbox"><input type="checkbox" name="teams" value="'+team.id+'">'+esc(team.name)+'</label>').join('')+'</fieldset>',attrs(organization.id));
      else if(op==='team'){
        const team=organization.teams.find(t=>t.id===id);form('team','teams',field(tr('teamName'),input('name',team?.name??'','required maxlength="160"'))+'<p>'+esc(tr('teamHelp'))+'</p><fieldset><legend>'+esc(tr('teamMembers'))+'</legend>'+organization.members.filter(m=>m.active).map(m=>'<label class="checkbox"><input type="checkbox" name="members" value="'+m.principalId+'" '+(team?.members.includes(m.principalId)?'checked':'')+'>'+esc(m.name)+'</label>').join('')+'</fieldset>',attrs(organization.id,team?.id??crypto.randomUUID()));
      }else if(op==='member'){
        const member=organization.members.find(m=>m.principalId===id);form('member','members','<p>'+esc(member.name)+'</p>'+selectRole(member.role)+'<p>'+esc(tr('roleHelp'))+'</p>'+button('removeMember','remove-member',attrs(organization.id,id)),attrs(organization.id,id));
      }else if(['remove-member','remove-team','revoke'].includes(op))form(op,op==='revoke'?'revoke':op==='remove-team'?'removeTeam':'removeMember','<label class="checkbox"><input name="confirmed" type="checkbox" required>'+esc(tr('confirmRemoval'))+'</label>',attrs(organization.id,id));
    }catch(error){displayError(error);}finally{busy=false;}
  }
  function inputEvent(element){
    if(!element.closest('[data-organization-form]'))return false;edited=true;
    if(element.hasAttribute('data-organization-identity')){
      const form=element.form,file=element.files?.[0];pendingFile=null;form.elements.verified.checked=false;
      void readFile(file).then(identity=>{if(!current()||!form.isConnected||element.files?.[0]!==file)return;if(identity.format!=='observanda-device-v1'||!/^[a-f0-9]{64}$/.test(identity.id))throw Error(tr('invalidFile'));pendingFile=identity;form.querySelector('[data-organization-fingerprint]').textContent=tr('fingerprint',{fingerprint:identity.id});}).catch(displayError);
    }
    return true;
  }
  async function submit(form,data){
    const kind=form.dataset.organizationForm;if(!kind||busy)return;busy=true;form.dataset.busy='true';
    const controls=[...form.querySelectorAll('input,select,textarea,button')].map(element=>({element,disabled:element.disabled}));
    for(const {element} of controls)element.disabled=true;form.setAttribute('aria-busy','true');
    const organizationId=form.dataset.organization,id=form.dataset.id;let completed=false;
    try{
      let result,message='saved';
      if(kind==='create')await call('create',{name:data.get('name').trim(),administratorName:data.get('administratorName').trim(),expectedRevision:snapshot.revision});
      else if(kind==='rename')await mutate('organization.rename',{organizationId,name:data.get('name').trim()});
      else if(kind==='team')await mutate('team.save',{organizationId,id,name:data.get('name').trim(),members:data.getAll('members')});
      else if(kind==='member')await mutate('member.change',{organizationId,principalId:id,role:data.get('role'),active:true});
      else if(['remove-member','remove-team','revoke'].includes(kind)){
        if(!data.has('confirmed'))throw Error(tr('confirmFirst'));
        if(kind==='remove-member')await mutate('member.change',{organizationId,principalId:id,role:org(organizationId).members.find(m=>m.principalId===id).role,active:false});
        else await mutate(kind==='remove-team'?'team.remove':'invitation.revoke',{organizationId,id});
      }else if(kind==='invite'){
        if(!pendingFile||!data.has('verified'))throw Error(tr('verifyFirst'));
        result=await mutate('invitation.create',{organizationId,identity:pendingFile,verifiedFingerprint:pendingFile.id,name:data.get('name').trim(),role:data.get('role'),teamIds:data.getAll('teams'),expiresAt:new Date(Date.now()+Number(data.get('days'))*86400000).toISOString()});download(result.file,'organization.observanda-invitation');message='invitationCreated';
      }else if(kind==='inspect'){
        const file=await readFile(data.get('file')),value=await call('inspect',{file});
        showDialog('<form data-module-form data-organization-form="accept"><h2 id="dialog-title">'+esc(tr('openInvitation'))+'</h2><p>'+esc(tr('inviteDetails',{organization:value.invitation.organizationName,role:tr(value.invitation.role),expires:value.invitation.expiresAt}))+'</p>'+(value.invitation.teams.length?'<h3>'+esc(tr('teams'))+'</h3><ul>'+value.invitation.teams.map(team=>'<li>'+esc(team.name)+'</li>').join('')+'</ul>':'')+'<code class="tool-hash">'+esc(tr('fingerprint',{fingerprint:value.inviterFingerprint}))+'</code><p>'+esc(tr('intro'))+'</p><label class="checkbox"><input type="checkbox" name="verified" required>'+esc(tr('verified'))+'</label><p role="alert" data-organization-error></p><div class="dialog-actions">'+button('close','close')+'<button class="button primary" type="submit">'+esc(tr('accept'))+'</button></div></form>');pendingFile=file;inspection=value;return;
      }else if(kind==='accept'){
        if(!pendingFile||!inspection||!data.has('verified'))throw Error(tr('verifyFirst'));result=await call('accept',{file:pendingFile,verifiedFingerprint:inspection.inviterFingerprint});download(result.file,'organization.observanda-acceptance');message='acceptanceCreated';
      }else if(kind==='receive'){result=await call('receive',{file:await readFile(data.get('file'))});download(result.file,'organization.observanda-membership');message='confirmationCreated';}
      else if(kind==='receipt')await call('receipt',{file:await readFile(data.get('file'))});
      completed=true;await refresh();await onUpdated();busy=false;close();render();notify(tr(message));
    }catch(error){
      // Keep the modal until its saved result has been refreshed; otherwise an
      // immediate click on the newly exposed page can be discarded as busy.
      // A refresh failure after a successful mutation must not invite resubmit.
      if(completed&&current()){busy=false;close();notify(error.message,true);}else displayError(error);
    }finally{busy=false;delete form.dataset.busy;form.removeAttribute('aria-busy');for(const {element,disabled} of controls)element.disabled=disabled;}
  }
  await refresh();
  return {view,action,input:inputEvent,submit,isDirty:()=>edited,activate:async()=>{if(!edited&&!busy)await refresh();},deactivate:close,dispose(){disposed=true;generation++;close();},discard:close,async save(){const form=document.querySelector('[data-organization-form]');if(form?.reportValidity())await submit(form,new FormData(form));}};
}
