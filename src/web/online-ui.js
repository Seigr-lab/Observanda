import {t} from './i18n/index.js';
import {onlineRoom} from './online-room.js';
import {onlineDraftsUI} from './online-drafts-ui.js';
import {onlineCreationUI} from './online-creation-ui.js';
const tr=(key,values)=>t('online',key,values);
export async function onlineUI({state,api,esc,field,showDialog,notify,render}){
 const context=state.storage.contextId,workspaceId=state.book.id;let snapshot=null,access=null,organizations=null,busy=false,disposed=false,dirty=false,connectionId=null,listing=null,room=null,roomElement=null,card=null,generation=0,showDrafts=false,notebookId='',recordId='',leaving=null;
 const current=()=>!disposed&&state.storage?.contextId===context&&state.book?.id===workspaceId;
 async function call(operation,data={}){if(!current())throw Error(tr('changedWorkspace'));const value=await api('/api/live/'+operation,{workspaceId,...data});if(!current())throw Error(tr('changedWorkspace'));return value;}
 const button=(key,action,attrs='')=>'<button type="button" class="button" data-action="module-command" data-command="online-'+action+'" '+attrs+'>'+esc(tr(key))+'</button>';
 const drafts=onlineDraftsUI({call,esc,render,button});
 const creation=onlineCreationUI({call,esc,field,form,error});
 const closeDialog=()=>{const dialog=document.querySelector('#dialog');if(dialog?.querySelector('[data-online-form]'))dialog.close();dirty=false;card=null;creation.clear();};
 const download=(value)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='connection.observanda-online';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 async function refresh(){const request=++generation,values=await Promise.all([call('state'),api('/api/sharing/state',{workspaceId}),api('/api/organizations/state',{workspaceId})]);if(current()&&request===generation)[snapshot,access,organizations]=values;}
 function form(kind,title,body,submit){dirty=kind==='create';showDialog('<form data-module-form data-online-form="'+kind+'"><h2 id="dialog-title">'+esc(tr(title))+'</h2>'+body+'<p role="alert" data-online-error></p><div class="dialog-actions">'+button('cancel','cancel')+'<button class="button primary" type="submit">'+esc(tr(submit))+'</button></div></form>');}
 function error(e){if(!current())return;const el=document.querySelector('[data-online-error]');if(el)el.textContent=e.message;else notify(e.message,true);}
 function view(){
  if(!snapshot)return '';
  if(showDrafts)return drafts.view();
  if(connectionId&&listing)return '<section class="panel online-research"><h2>'+esc(snapshot.connections.find(c=>c.id===connectionId)?.title??tr('title'))+'</h2>'+button('close','close')+field(tr('book'),'<select data-online-book><option value="">'+esc(tr('title'))+'</option>'+listing.notebooks.map(n=>'<option value="'+n.id+'" '+(n.id===notebookId?'selected':'')+'>'+esc(n.title)+'</option>').join('')+'</select>')+field(tr('record'),'<select data-online-record><option value="">'+esc(tr('record'))+'</option>'+listing.records.map(r=>'<option value="'+r.id+'" '+(r.id===recordId?'selected':'')+'>'+esc(r.title)+'</option>').join('')+'</select>')+'<div class="module-actions">'+(listing.role==='editor'||creation.pending()?button(creation.pending()?'creationResume':'creationNew','create'):'')+button('first','first')+(listing.next?button('next','next'):'')+'</div><div data-online-room-host></div></section>';
  const grants=access.grants.filter(g=>g.active),cards=snapshot.hosting&&grants.length?'<form data-module-form data-online-form="card">'+field(tr('grant'),'<select name="grantId">'+grants.map(g=>{const org=organizations.organizations.find(o=>o.id===g.organizationId),name=g.recipient.kind==='member'?org?.members.find(m=>m.principalId===g.recipient.id)?.name:org?.teams.find(t=>t.id===g.recipient.id)?.name;return '<option value="'+g.id+'">'+esc(name??'')+' · '+g.scopes.map(s=>esc((s.kind==='notebook'?access.notebooks:access.projects).find(n=>n.id===s.id)?.title??'')).join(', ')+'</option>';}).join('')+'</select>')+'<button class="button">'+esc(tr('card'))+'</button></form>':'';
  return '<section class="panel online-research"><h2>'+esc(tr('title'))+'</h2><p>'+esc(tr('intro'))+'</p><div class="module-actions">'+(snapshot.hosting?button('stop','stop'):grants.length?button('start','start'):'')+button('connect','connect')+button('refresh','refresh')+button('draftLibrary','drafts')+'</div>'+(snapshot.hosting?'<p>'+esc(tr('hosting',snapshot.hosting))+'</p>':'')+(!grants.length?'<p>'+esc(tr('noGrants'))+'</p>':'')+cards+snapshot.connections.map(c=>'<article><h3>'+esc(c.title)+'</h3><p>'+esc(c.endpoint)+'</p><div class="module-actions">'+button('open','open','data-id="'+c.id+'"')+button('disconnect','disconnect','data-id="'+c.id+'"')+'</div></article>').join('')+'</section>';
 }
 async function leave(options){if(leaving)return leaving;leaving=(async()=>{await room?.close(options);room=null;roomElement=null;connectionId=null;listing=null;notebookId='';recordId='';})();try{await leaving;}finally{leaving=null;}}
 async function records(data={}){listing=await call('request',{connectionId,operation:'list',data:{...(notebookId?{notebookId}:{}),...data}});await creation.load(connectionId);recordId='';render();}
 async function openRecord(id,field='body'){if(!room){roomElement=document.createElement('div');room=onlineRoom({call,connectionId,context,esc,notify});room.attach(roomElement);bind();}if(await room.open(id,field)){recordId=id;const select=document.querySelector('[data-online-record]');if(select)select.value=id;}}
 async function action(command,node){
  if(!command?.startsWith('online-')||busy)return;busy=true;
  try{const op=command.slice(7);
   if(op==='cancel'){closeDialog();return;}
   if(op==='create'){if(room?.isDirty()){notify(tr('finishForms'),true);return;}await creation.open(connectionId,listing.notebooks,notebookId);return;}
   if(op==='drafts'){await leave();showDrafts=true;await drafts.load();return;}
   if(op==='connections'){showDrafts=false;drafts.clear();await refresh();render();return;}
   if(op==='draft-review'){const selected=drafts.selected();if(!selected)return;if(!snapshot.connections.some(c=>c.id===selected.connectionId))throw Error(tr('draftReconnect'));connectionId=selected.connectionId;await records();showDrafts=false;render();await openRecord(selected.recordId,selected.field);return;}
   if(op.startsWith('draft-')){await drafts.action(op,node);return;}
   if(op==='start'){form('start','start','<p>'+esc(tr('hostHelp'))+'</p>'+field(tr('address'),'<input name="address" value="'+esc(snapshot.addresses[0]??'127.0.0.1')+'" required>')+field(tr('port'),'<input name="port" type="number" min="0" max="65535" value="4174" required>'),'start');return;}
   if(op==='connect'){form('connect','connect','<p>'+esc(tr('connectHelp'))+'</p>'+field(tr('file'),'<input name="file" type="file" data-online-file accept=".observanda-online,.json" required>')+'<p data-online-fingerprint></p><label class="checkbox"><input name="verified" type="checkbox" required>'+esc(tr('verify'))+'</label>','connect');return;}
   if(op==='stop'){await call('stop');await refresh();render();notify(tr('stopped'));return;}
   if(op==='disconnect'){await call('disconnect',{connectionId:node.dataset.id});await refresh();render();return;}
   if(op==='open'){connectionId=node.dataset.id;notebookId='';await records();return;}
   if(op==='close'){await leave();await refresh();render();return;}
   if(op==='first'||op==='next'){if(room?.isDirty()){notify(tr('keepOpen'),true);return;}await room?.close();room=null;roomElement=null;await records({...(op==='next'?{after:listing.next}:{})});return;}
   if(op==='refresh'){await refresh();render();}
  }catch(e){error(e);}finally{busy=false;}
 }
 function input(element){
  if(creation.input(element)){dirty=true;return true;}
  if(element.hasAttribute('data-online-file')){dirty=true;card=null;const file=element.files?.[0];void(async()=>{if(!file?.size||file.size>32768)throw Error(tr('invalidFile'));const value=JSON.parse(await file.text());if(!/^[a-f0-9]{64}$/.test(value.identity?.id??''))throw Error(tr('invalidFile'));if(!current()||element.files?.[0]!==file)return;card=value;document.querySelector('[data-online-fingerprint]').textContent=tr('fingerprint',{fingerprint:value.identity.id});})().catch(error);return true;}
  if(element.hasAttribute('data-online-record')){const selected=element.value;element.value=recordId;if(!selected||busy)return true;if(room?.isDirty()){notify(tr('keepOpen'),true);return true;}busy=true;void openRecord(selected).catch(error).finally(()=>{busy=false;});return true;}
  if(element.hasAttribute('data-online-book')){const selected=element.value;element.value=notebookId;if(busy)return true;if(room?.isDirty()){notify(tr('keepOpen'),true);return true;}busy=true;void(async()=>{await room?.close();room=null;roomElement=null;const previous=notebookId;notebookId=selected;try{await records();}catch(e){notebookId=previous;throw e;}})().catch(error).finally(()=>{busy=false;});return true;}
  if(element.closest('[data-online-form]')){dirty=true;return true;}return false;
 }
 async function submit(formElement,data){
  const kind=formElement.dataset.onlineForm;if(!kind||busy)return;busy=true;let completed=false;const button=formElement.querySelector('[type=submit],button:not([type])');if(button)button.disabled=true;
  try{
   if(kind==='create'){
    const result=await creation.submit(formElement);if(!result)return;
    closeDialog();if(result.removed){render();notify(tr('creationRemoved'));return;}
    await room?.close();room=null;roomElement=null;notebookId=result.record.notebookId;
    await records();if(!listing.records.some(r=>r.id===result.record.id))listing.records.unshift(result.record);
    render();await openRecord(result.record.id);notify(tr('creationSaved'));return;
   }
   if(kind==='start'){await call('start',{endpoint:'https://'+data.get('address'),port:Number(data.get('port'))});}
   if(kind==='connect'){if(!card||!data.get('verified'))throw Error(tr('invalidFile'));await call('connect',{card,verifiedFingerprint:card.identity.id});}
   if(kind==='card'){download((await call('card',{grantId:data.get('grantId')})).card);dirty=false;return;}
   completed=true;await refresh();busy=false;closeDialog();render();if(kind==='connect')notify(tr('connected'));
  }catch(e){if(completed){busy=false;closeDialog();notify(e.message,true);}else error(e);}finally{busy=false;if(button)button.disabled=false;}
 }
 function bind(){const host=document.querySelector('[data-online-room-host]');if(host&&roomElement&&roomElement.parentElement!==host)host.replaceChildren(roomElement);}
 await refresh();return {view,bind,action,input,submit,isDirty:()=>busy||dirty||!!room?.isDirty(),activate:async()=>{if(!busy&&!dirty)await refresh();},deactivate:()=>{closeDialog();void leave().catch(error);},dispose:()=>{closeDialog();void leave().catch(error).finally(()=>{disposed=true;drafts.clear();});},discard:async()=>{closeDialog();await leave({discardForms:true});},save:async()=>{const formElement=document.querySelector('#dialog[open] [data-online-form]');if(formElement){if(!formElement.reportValidity())throw Error(tr('finishConnectionForm'));await submit(formElement,new FormData(formElement));if(document.querySelector('#dialog[open] [data-online-form]'))throw Error(tr('finishConnectionForm'));}await room?.save();await leave();}};
}
