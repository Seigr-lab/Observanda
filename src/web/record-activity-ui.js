import {activityContext,activityTemplates,activityChoices,documentRecord} from './record-activity.js';
import {recordBrowse} from './record-query.js';
import {recordDateLabel} from './record-date.js';
import {editableRecord} from './workspace-snapshot.js';
import {researchTargetPicker} from './research-target-picker.js';

export function recordActivityUI({state,api,esc,field,showDialog,notify,render,dirty,revisions,create,getRecord}){
 const targets=researchTargetPicker({state,api,esc,field,showDialog});
 let key='',result=null,error=null,loading=false,controller=null,generation=0,opened=false,creation=null;
 const record=getRecord??(()=>state.book?.entries.find(e=>e.id===state.selected));
 const active=()=>['editor','record-reader'].includes(state.page)&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace&&!!record();
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.selected,state.etag]);
 const button=(label,action,extra='')=>`<button type="button" class="button" data-action="record-activity-${action}" ${extra}>${label}</button>`;
 function closeCreation(){if(creation&&document.querySelector('#dialog [data-activity-creation]'))document.querySelector('#dialog').close();creation=null;}
 function stop(){closeCreation();targets.stop();controller?.abort();controller=null;generation++;key='';result=null;error=null;loading=false;opened=false;}
 function sync(){const next=identity();if(next!==key){stop();key=next;opened=activityContext(state.book,record()).subject;}}
 function history(){
  if(!opened)return button('Show linked records','show');
  if(error)return `<p role="alert">${esc(error.message)}</p>${button('Retry linked records','refresh')}`;
  if(loading||!result)return '<p role="status">Loading linked records...</p>';
  return `${result.changed?'<p role="status">Records have changed. Refresh to see the latest history.</p>':''}<p tabindex="-1" data-activity-status>${result.total?`${result.offset+1}-${result.offset+result.records.length} of ${result.total} linked records`:'No linked records yet.'}</p>
   <ol class="run-list">${result.records.map(e=>`<li><a href="#/records/${e.id}/read" data-action="record-read-linked" data-id="${e.id}">${esc(e.title)}</a><span>${esc(recordDateLabel(e.occurredOn))} &middot; ${esc(e.template?.label??e.type)} &middot; ${esc(e.status)}</span>${(e.linkedBy??[]).map(l=>`<small>${esc(l.type)}${l.revision?' &middot; Retained revision '+esc(l.revision.slice(0,10))+(l.revision!==revisions()[record().id]?' (different from current)':''):''}</small>`).join('')}</li>`).join('')}</ol>
   <nav class="inline-actions" aria-label="Linked record pages">${button('Previous records','previous',!result.previousCursor?'disabled':'')}${button('Next records','next',!result.nextCursor?'disabled':'')}${button('Refresh history','refresh')}</nav>`;
 }
 function view({readonly=false}={}){
  sync();const e=record(),context=activityContext(state.book,e),templates=activityTemplates(state.book,e,state.dashboardSettings);
  const primary=context.subject?templates.find(s=>s.profileId===e.template.profileId&&s.key===context.tracking.primary):null;
  const heading=context.subject?(context.tracking.headings?.[context.section.key]??'Linked records'):'Linked records';
  const choose=readonly||!context.event?'':button('Choose '+esc((context.tracking.subjectLabel??'subject record').toLocaleLowerCase()),'subjects');
  return `<section class="record-activity" aria-label="${heading}"><header><h2>${heading}</h2><div class="inline-actions">${primary?button(esc(context.tracking.primaryLabel??'New related record'),'inspect'):''}${button('Add linked record','create')}</div></header>${choose}<div data-activity-results>${history()}</div></section>`;
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
 function bind(){targets.sync();if(!active()){stop();return;}sync();if(opened&&!result&&!error&&!loading)void load();}
 async function action(control){
  if(await targets.action(control))return true;
  const name=control.dataset.action;if(!name?.startsWith('record-activity-')||!active())return false;
  sync();const e=record(),context=activityContext(state.book,e);
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
   const section=activityTemplates(state.book,e,state.dashboardSettings).find(s=>context.subject&&s.profileId===e.template.profileId&&s.key===context.tracking.primary);
   if(section)create('note',e.notebookId,section,e);return true;
  }
  if(name==='record-activity-create'){
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
 return {view,bind,action,stop,input:targets.input};
}
