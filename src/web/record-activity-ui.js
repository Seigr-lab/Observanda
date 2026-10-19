import {t} from './i18n/index.js';
import {enabledModule} from './feature-modules.js';
import {laboratoryModuleId} from './laboratory/catalog.js';
import {configurationDocumentClient} from './configuration-document-client.js';
import {configurationTypeChoices} from './configuration-type-choices.js';
import {activityContext,activityTemplates,activityChoices,documentRecord} from './record-activity.js';
import {recordBrowse} from './record-query.js';
import {recordDateLabel} from './record-date.js';
import {editableRecord} from './workspace-snapshot.js';
import {researchTargetPicker} from './research-target-picker.js';

export function recordActivityUI({state,api,esc,field,showDialog,notify,render,dirty,revisions,create,getRecord}){
 const targets=researchTargetPicker({state,api,esc,field,showDialog});
 const configuration=configurationDocumentClient({state,api});
 const typeChoices=configurationTypeChoices({state,api,esc,showDialog});
 let selectedSection=null,selectedPrimary=null,contextPending=null,contextError=null,contextLoaded=false,contextGeneration=0;
 const native=()=>state.storage?.researchStorage==='catalogue';
 const contextFor=entry=>activityContext(state.book,entry,{selectedSection});
 let key='',result=null,error=null,loading=false,controller=null,generation=0,opened=false,creation=null;
 const record=getRecord??(()=>state.book?.entries.find(e=>e.id===state.selected));
 const active=()=>['editor','record-reader'].includes(state.page)&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace&&!!record();
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.selected,state.etag]);
 const button=(label,action,extra='')=>`<button type="button" class="button" data-action="record-activity-${action}" ${extra}>${label}</button>`;
 function closeCreation(){if(creation&&document.querySelector('#dialog [data-activity-creation]'))document.querySelector('#dialog').close();creation=null;}
 function stop(){closeCreation();targets.stop();configuration.stop();typeChoices.stop();contextGeneration++;contextLoaded=false;selectedSection=selectedPrimary=contextPending=contextError=null;controller?.abort();controller=null;generation++;key='';result=null;error=null;loading=false;opened=false;}
 function sync(){const next=identity();if(next!==key){stop();key=next;opened=contextFor(record()).subject;}}
 function history(){
  if(!opened)return button('Show linked records','show');
  if(error)return `<p role="alert">${esc(error.message)}</p>${button('Retry linked records','refresh')}`;
  if(loading||!result)return '<p role="status">Loading linked records...</p>';
  return `${result.changed?'<p role="status">Records have changed. Refresh to see the latest history.</p>':''}<p tabindex="-1" data-activity-status>${result.total?`${result.offset+1}-${result.offset+result.records.length} of ${result.total} linked records`:'No linked records yet.'}</p>
   <ol class="run-list">${result.records.map(e=>`<li><a href="#/records/${e.id}/read" data-action="record-read-linked" data-id="${e.id}">${esc(e.title)}</a><span>${esc(recordDateLabel(e.occurredOn))} &middot; ${esc(e.template?.label??e.type)} &middot; ${esc(e.status)}</span>${(e.linkedBy??[]).map(l=>`<small>${esc(l.type)}${l.revision?' &middot; Retained revision '+esc(l.revision.slice(0,10))+(l.revision!==revisions()[record().id]?' (different from current)':''):''}</small>`).join('')}</li>`).join('')}</ol>
   <nav class="inline-actions" aria-label="Linked record pages">${button('Previous records','previous',!result.previousCursor?'disabled':'')}${button('Next records','next',!result.nextCursor?'disabled':'')}${button('Refresh history','refresh')}</nav>`;
 }
 function view({readonly=false}={}){
  sync();const e=record(),context=contextFor(e),templates=native()?[]:activityTemplates(state.book,e,state.dashboardSettings);
  const primary=native()?selectedPrimary:context.subject?templates.find(s=>s.profileId===e.template.profileId&&s.key===context.tracking.primary):null;
  const heading=context.subject?(context.tracking.headings?.[context.section.key]??'Linked records'):'Linked records';
  const choose=readonly||!context.event?'':button('Choose '+esc((context.tracking.subjectLabel??'subject record').toLocaleLowerCase()),'subjects');
  return `<section class="record-activity" aria-label="${heading}"><header><h2>${heading}</h2><div class="inline-actions">${!readonly&&primary?button(esc(context.tracking.primaryLabel??'New related record'),'inspect'):''}${readonly?'':button('Add linked record','create')}</div></header>${choose}${contextError?'<p role="status">'+esc(contextError.message)+'</p>'+button(esc(t('configurationEditor','retry')),'context-retry'):contextPending?'<p role="status">'+esc(t('configurationEditor','loading'))+'</p>':''}<div data-activity-results>${history()}</div></section>`;
 }
 function paint(){const area=document.querySelector('[data-activity-results]');if(active()&&area)area.innerHTML=history();}
 async function load(cursor=null,focus=false){
  if(!active())return;sync();const request=++generation,requestedKey=key;controller?.abort();controller=new AbortController();loading=true;error=null;paint();
  try{
   const data=await api('/api/research/records/query',{workspaceId:state.book.id,query:{projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse()},relatedTo:{workspaceId:state.book.id,id:record().id},cursor,limit:10},{adopt:false,signal:controller.signal});
   if(request!==generation||!active()||identity()!==requestedKey)return;
   if(data.workspaceId!==state.book.id||!Array.isArray(data.records)||data.records.length>10||!Number.isSafeInteger(data.total)||!Number.isSafeInteger(data.offset)||data.offset<0||data.offset+data.records.length>data.total||data.nextCursor!==null&&typeof data.nextCursor!=='string'||data.previousCursor!==null&&typeof data.previousCursor!=='string')throw Error('The linked record response was incomplete. Refresh history.');
   result=data;loading=false;paint();if(focus)document.querySelector('[data-activity-status]')?.focus();
  }catch(e){if(request===generation&&active()&&identity()===requestedKey&&e.name!=='AbortError'){error=e;loading=false;paint();}}
 }
 function bind(){targets.sync();if(!active()){stop();return;}sync();if(native()&&!contextPending&&!contextLoaded&&!contextError&&record().template?.id)void loadContext();if(opened&&!result&&!error&&!loading)void load();}
 async function action(control){
  if(await targets.action(control)||await typeChoices.action(control))return true;
  const name=control.dataset.action;if(!name?.startsWith('record-activity-')||!active())return false;
  sync();const e=record(),context=contextFor(e);
  if(name==='record-activity-context-retry'){await loadContext();return true;}
  if(['record-activity-show','record-activity-refresh','record-activity-next','record-activity-previous'].includes(name)){
   if(loading)return true;opened=true;await load(name==='record-activity-next'?result?.nextCursor:name==='record-activity-previous'?result?.previousCursor:null,true);return true;
  }
  if(name==='record-activity-subjects'){
   targets.open({title:'Link '+(context.tracking?.subjectLabel??'subject record').toLocaleLowerCase(),recordType:'subject',recordsOnly:true,onChoose:(subject,{stillCurrent})=>{
    if(!stillCurrent())return;
    if(!documentRecord(state.book.id,editableRecord(state.book,e.id),subject))throw Error('That record is already linked.');
    dirty();document.querySelector('#dialog').close();targets.stop();render();
   }});return true;
  }
  if(state.dirty||state.page!=='record-reader'&&!revisions()[e.id]){notify('Save this record before adding a linked record.',true);return true;}
  if(name==='record-activity-inspect'){
   if(native()){if(contextPending)await contextPending;if(selectedPrimary)await create('note',e.notebookId,{...selectedPrimary.value,sectionId:selectedPrimary.key,configurationPin:configuration.descriptor().configurationPin},e);return true;}
   const section=activityTemplates(state.book,e,state.dashboardSettings).find(s=>context.subject&&s.profileId===e.template.profileId&&s.key===context.tracking.primary);
   if(section)create('note',e.notebookId,section,e);return true;
  }
  if(name==='record-activity-create'){
   if(native()){await typeChoices.open(state.book.notebooks.find(book=>book.id===e.notebookId),{title:'Add linked record',description:'About: '+e.title,onChoose:async choice=>{document.querySelector('#dialog').close();await create(choice.type,choice.notebookId,choice.section??null,e);}});return true;}
   const choices=activityChoices(state.book,e,state.dashboardSettings);
   creation=key;showDialog(`<h2 id="dialog-title" data-activity-creation>Add linked record</h2><p>About: ${esc(e.title)}</p>${field('Record template',`<select id="activity-template">${choices.map(c=>`<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select>`)}<div class="dialog-actions">${button('Create record','confirm')}${button('Cancel','cancel')}</div>`);return true;
  }
  if(name==='record-activity-confirm'){
   if(creation!==key||!document.querySelector('#dialog')?.open)return true;
   const choice=activityChoices(state.book,e,state.dashboardSettings).find(c=>c.value===document.querySelector('#activity-template')?.value);
   if(choice){closeCreation();create(choice.type,e.notebookId,choice.section,e);}return true;
  }
  if(name==='record-activity-cancel'){closeCreation();return true;}
  return false;
 }
 async function loadContext(){
  const entry=record(),notebook=state.book.notebooks.find(book=>book.id===entry?.notebookId),request=++contextGeneration;if(!notebook)return;
  contextPending=(async()=>{
   try{
    await configuration.open({workspaceId:state.book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'},{saved:true});
    const section=await configuration.section({sectionId:entry.template.id});if(request!==contextGeneration)return;
    const selected=section?.value??null,context=activityContext(state.book,entry,{selectedSection:selected});let primary=null;
    if(context.subject&&enabledModule(state.dashboardSettings,laboratoryModuleId(entry.template.profileId))){
     const profiles=await configuration.profiles([entry.template.profileId]);
     if(profiles.profiles.some(profile=>profile.id===entry.template.profileId&&profile.enabled)){const row=await configuration.section({profileId:entry.template.profileId,key:context.tracking.primary});if(row?.value.enabled)primary=row;}
    }
    if(request!==contextGeneration)return;selectedSection=selected;selectedPrimary=primary;contextLoaded=true;contextError=null;if(context.subject)opened=true;
    if(opened&&!result&&!loading&&!error)void load();
   }catch(reason){if(request===contextGeneration&&reason.name!=='AbortError')contextError=reason;}
   finally{if(request===contextGeneration){contextPending=null;const host=document.querySelector('.record-activity');if(active()&&host)host.outerHTML=view({readonly:state.page==='record-reader'});}}
  })();return contextPending;
 }
 return {view,bind,action,stop,input:element=>typeChoices.input(element)||targets.input(element)};
}
