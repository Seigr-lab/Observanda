import {configurationProfileLabels} from './configuration-profile-labels.js';
import {configurationEditor} from './configuration-editor.js';
import {configurationDocumentClient} from './configuration-document-client.js';
import {t} from './i18n/index.js';

import {projectSettings} from './project-settings.js';
import {newLabBookConfiguration,templateAvailable,templateChoices,starterTemplate} from './project-templates.js';
import {enabledLabBookTypes} from './feature-modules.js';
import {enableProfile} from './laboratory/catalog.js';
import {notebookDirectory,notebookTypes,notebookRoute} from './laboratory/notebook-model.js';
import {configurationOf,validConfiguration} from './notebook-schema.js';
import {locationName,recordsIn} from './workspace-structure.js';
import {sectionDetails,sectionInput,sectionAction} from './laboratory/section-editor.js';

export function projectNotebooksUI(services){
 const {state,api,esc,field,option,showDialog,render,notify}=services;
 let editing=null,base=null,selected=null,etag=null,deleting=null,deleteBusy=false,creating=false,templateChoice='blank',followProjectDefault=true,creationId=null;
 const projects=projectSettings(services);
 const profileLabels=configurationProfileLabels({state,api,esc});
 const native=()=>state.storage?.researchStorage==='catalogue';
 const available=template=>native()?Boolean(template):templateAvailable(template,state.dashboardSettings);
 const configuration=configurationEditor({...services,draw:()=>{if(editing&&active())draw();},root:()=>active()?.querySelector('[data-configuration-editor]')});
 const sourceReader=configurationDocumentClient({state,api});
 let baseTemplate='blank';
 const attrs=route=>Object.entries(route).map(([key,value])=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+'="'+esc(value)+'"').join(' ');
 const directory=(id,options)=>notebookDirectory(state.book,id,{...options,types:profileLabels.types,counts:state.workspaceOutline?.notebookCounts??state.recordScope?.notebookCounts});
 const recordCount=id=>(state.workspaceOutline?.notebookCounts??state.recordScope?.notebookCounts)?.[id]??state.book.entries.filter(e=>e.notebookId===id).length;
 const active=()=>editing&&document.querySelector('#dialog[open] #notebook-config-form');
 function applyTemplate(){
  if(native())return;
  const template=templateChoice==='default'?state.book.projects.find(p=>p.id===editing.projectId)?.labBookTemplate:
   templateChoice.startsWith('profile:')?starterTemplate(templateChoice.slice(8)):
   templateChoices(state.book,state.dashboardSettings).find(p=>'project:'+p.id===templateChoice)?.template;
  editing.configuration=newLabBookConfiguration(template,state.dashboardSettings);
 }
 function useProjectDefault(){
  templateChoice=available(state.book.projects.find(p=>p.id===editing.projectId)?.labBookTemplate)?'default':'blank';applyTemplate();
 }
 function capture(){
  const form=active();if(!form)return;
  editing.title=form.elements.title.value;
  const owner=form.elements.projectId.value,changed=owner!==editing.projectId;editing.projectId=owner;
  if(creating&&changed&&followProjectDefault)useProjectDefault();
 }
 function templatePicker(){
  const settings=state.dashboardSettings,template=state.book.projects.find(p=>p.id===editing.projectId)?.labBookTemplate;
  const profiles=enabledLabBookTypes(settings),saved=(native()?state.book.projects.filter(p=>p.labBookTemplate).map(p=>({id:p.id,label:p.labBookTemplate.name+' / '+p.title,template:p.labBookTemplate})):templateChoices(state.book,settings)).filter(p=>p.id!==editing.projectId||templateChoice==='project:'+p.id);
  return field('Lab-book template',`<select data-notebook-template>
   ${available(template)?option('default',template.name+' (project default)',templateChoice):''}
   ${option('blank','Blank lab book',templateChoice)}
   ${profiles.length?'<optgroup label="Enabled lab-book types">'+profiles.map(p=>option('profile:'+p.id,p.label,templateChoice)).join('')+'</optgroup>':''}
   ${saved.length?'<optgroup label="Saved project templates">'+saved.map(p=>option('project:'+p.id,p.label,templateChoice)).join('')+'</optgroup>':''}
  </select>`)+`<p class="muted">${esc(t('templatePreferences','chooseMore',{preferences:t('preferences','title'),templates:t('preferences','templates')}))}</p>`;
 }
 const isDirty=()=>{if(deleteBusy)return false;capture();return !!editing&&(JSON.stringify(editing)!==JSON.stringify(base)||configuration.isDirty()||creating&&templateChoice!==baseTemplate);};
 function card(n){return `<article class="panel project-notebook"><p class="scope-kicker">Lab book</p><h2><button class="text-button" ${attrs(n.route)}>${esc(n.title)}</button></h2>
  <p class="muted">${n.count} ${n.count===1?'record':'records'}</p><div class="lab-profile-tags" data-configuration-profiles="${n.id}">${n.types.map(t=>'<span>'+esc(t)+'</span>').join('')}</div>
  <div class="inline-actions"><button class="button" ${attrs(n.route)}>Open lab book</button><button class="button" data-action="edit-notebook" data-id="${n.id}">Lab book settings</button></div></article>`;}
 const button=(label,command,attrs='',style='')=>`<button type="button" class="button ${style}" data-action="notebook-config-command" data-command="${command}" ${attrs}>${esc(label)}</button>`;
 function draw(initial=false){
  const dialog=document.querySelector('#dialog'),scroll=dialog.querySelector('.notebook-config-scroll')?.scrollTop??0,focused=document.activeElement;
  const focusAttribute=['data-notebook-template','data-notebook-owner','data-notebook-profile','data-notebook-type','data-lab-field-prop'].find(key=>focused?.hasAttribute(key));
  const focusSelector=focusAttribute?'['+focusAttribute+'="'+CSS.escape(focused.getAttribute(focusAttribute))+'"]'+(focused.hasAttribute('data-lab-field')?'[data-lab-field="'+focused.dataset.labField+'"]':''):null;
  const c=native()?null:editing.configuration,choices=c?.sections??[];
  if(!choices.some(s=>s.id===selected))selected=choices[0]?.id;
  const section=choices.find(s=>s.id===selected),index=choices.indexOf(section),siblings=choices.filter(s=>s.enabled&&s.profileId===section?.profileId),position=siblings.indexOf(section);
  const profiles=enabledLabBookTypes(state.dashboardSettings),projectTemplate=state.book.projects.find(p=>p.id===editing.projectId)?.labBookTemplate;
  showDialog(`<form id="notebook-config-form" class="notebook-config-form ${creating?'notebook-create-form':''}"><h2 id="dialog-title" tabindex="-1">${creating?'New lab book':'Lab book settings'}</h2>
   <div class="notebook-config-scroll"><div class="form-grid">${field('Lab book name',`<input name="title" required maxlength="160" value="${esc(editing.title)}">`)}
   ${field('Project',`<select name="projectId" data-notebook-owner required>${state.book.projects.map(p=>option(p.id,locationName(state.book,p.id),editing.projectId)).join('')}</select>`)}</div>
   ${creating&&projectTemplate&&!available(projectTemplate)?'<p class="muted">'+esc(t('templatePreferences','defaultUnavailable',{preferences:t('preferences','title'),templates:t('preferences','templates')}))+'</p>':''}${creating?templatePicker():native()?configuration.view():`<fieldset class="notebook-profile-choices"><legend>Lab-book types</legend>
    ${profiles.map(p=>`<label class="checkbox"><input type="checkbox" data-notebook-profile="${p.id}" ${c.profiles.some(ch=>ch.id===p.id&&ch.enabled)?'checked':''}>${esc(p.label)}</label>`).join('')||'<p>'+esc(t('templatePreferences','enableTypes',{preferences:t('preferences','title'),templates:t('preferences','templates')}))+'</p>'}
   </fieldset>
   <div class="notebook-type-picker">${field('Record type',`<select data-notebook-type>${choices.map(s=>option(s.id,s.label+(s.enabled?'':' (removed)'),selected)).join('')}</select>`)}${button('Add record type','section-add','','subtle')}</div>
   <div class="lab-type-layout"><aside class="lab-type-catalogue" aria-label="Record types"><div class="lab-type-list-heading"><strong>Record types</strong>${button('Add record type','section-add','','subtle')}</div>
    ${choices.map(s=>`<button type="button" class="lab-type-choice" data-action="notebook-config-command" data-command="select-type" data-id="${s.id}" aria-current="${s.id===selected}"><span>${esc(s.label)}</span><small>${s.enabled?s.fields.length+' fields':'Removed'}</small></button>`).join('')||'<p class="muted">Choose a lab-book type or add your own record types. Every lab book also supports free-form records.</p>'}
   </aside><section class="lab-type-detail" aria-label="Selected record type">${section?`<div class="lab-type-detail-heading"><strong>${section.enabled?'Type details':'Removed type'}</strong><div>${button('Move up','section-move',`data-index="${index}" data-direction="-1" ${position<=0?'disabled':''}`,'subtle')}${button('Move down','section-move',`data-index="${index}" data-direction="1" ${position<0||position>=siblings.length-1?'disabled':''}`,'subtle')}${button(section.enabled?'Remove type':'Restore type',section.enabled?'section-remove':'section-restore',`data-index="${index}"`,'subtle')}</div></div>${sectionDetails(section,index,{field,esc,option,button})}`:'<p>Choose a type to edit its name and fields.</p>'}</section></div>`}
   <p class="module-error" data-notebook-error role="alert" tabindex="-1" hidden></p></div>
   <div class="dialog-actions lab-book-actions">${state.book.notebooks.some(n=>n.id===editing.id)?`<button type="button" class="button danger" data-action="lab-book-delete">Delete lab book</button>`:''}<button type="button" class="button" data-action="close-dialog">Cancel</button><button type="submit" class="button primary" ${native()&&!creating&&configuration.busy()?'disabled':''}>Save lab book</button></div></form>`);
  if(initial){dialog.querySelector('h2').focus({preventScroll:true});dialog.scrollTop=0;}
  else {if(focusSelector)dialog.querySelector(focusSelector)?.focus({preventScroll:true});dialog.querySelector('.notebook-config-scroll').scrollTop=scroll;}
 }
 async function openNotebook(id,projectId){
  const current=state.book.notebooks.find(n=>n.id===id),owner=projectId??state.project??state.book.projects[0]?.id,template=state.book.projects.find(p=>p.id===owner)?.labBookTemplate;
  creating=!current;creationId=crypto.randomUUID();followProjectDefault=true;templateChoice=available(template)?'default':'blank';baseTemplate=templateChoice;
  configuration.stop();sourceReader.stop();
  if(native()){const {configuration:ignored,...header}=current??{id:crypto.randomUUID(),title:'',projectId:owner};void ignored;editing=structuredClone(header);}
  else {editing=structuredClone(current??{id:crypto.randomUUID(),title:'',projectId:owner,configuration:newLabBookConfiguration(template,state.dashboardSettings)});editing.configuration=structuredClone(configurationOf(editing));}
  base=structuredClone(editing);
  etag=state.etag;selected=null;draw(true);
  if(native()&&!creating)await configuration.open({workspaceId:state.book.id,projectId:editing.projectId,notebookId:editing.id,slot:'configuration'});
 }
 function deletionDialog(){
  const source=state.book.notebooks.find(n=>n.id===deleting.id),count=recordCount(source.id),choices=state.book.notebooks.filter(n=>n.id!==source.id);
  showDialog(`<form id="lab-book-delete-form" data-no-draft data-navigation-ready><h2 id="dialog-title">Delete lab book</h2><p>Delete <strong>${esc(source.title)}</strong> from ${esc(locationName(state.book,source.projectId))}?</p>
   ${state.projectOwner?.labBookId===source.id?'<p>'+esc(t('labBookDirectory','deleteEffect'))+'</p>':''}
   ${count?`<p>This lab book contains <strong>${count} ${count===1?'record':'records'}</strong>.</p>
   ${field('What should happen to its records?',`<select name="records" required data-lab-book-delete-records>${option('','Choose what to do',deleting.records)}${choices.length?option('move','Move records to another lab book',deleting.records):''}${option('delete','Delete records with this lab book',deleting.records)}</select>`)}
   ${deleting.records==='move'?field('Destination lab book',`<select name="destinationId" required>${option('','Choose a lab book',deleting.destinationId??'')}${choices.map(n=>option(n.id,locationName(state.book,n.projectId)+' / '+n.title,deleting.destinationId)).join('')}</select>`)+'<p class="muted">Records keep their contents and links. Moving them to another project makes them private until you choose to publish them again.</p>':deleting.records==='delete'?'<p class="lab-book-delete-warning">The lab book and all its records will be removed from the current workspace.</p>':''}`:'<p>This lab book is empty.</p>'}
   <p class="module-error" data-delete-error role="alert" tabindex="-1" hidden></p>
   <div class="dialog-actions"><button type="button" class="button" data-action="lab-book-delete-cancel">Cancel</button><button type="submit" class="button danger">${deleting.records==='move'?'Move records and delete lab book':'Delete lab book'}</button></div></form>`);
 }
 async function confirmDeletion(form,data){
  if(deleteBusy)return true;
  const source=state.book.notebooks.find(n=>n.id===deleting.id);
  const value={id:source.id,records:deleting.records,destinationId:data.get('destinationId')||null,confirmed:true};
  deleteBusy=true;form.dataset.busy='true';form.querySelectorAll('button,select').forEach(n=>n.disabled=true);
  try{
   if(state.projectOwner?.labBookId===source.id){
    const item={id:deleting.commandId,labBookId:source.id,name:source.title};
    await services.enterProject(source.projectId);state.project=source.projectId;state.notebook='all';state.selected=null;state.recordReturn=null;state.page='project';editing=base=deleting=null;document.querySelector('#dialog').close();render();
    await services.labBookDirectory.deleteBook(source.projectId,item);return true;
   }
   const result=await api('/api/workspace/structure',{etag,change:{kind:'delete-notebook',value}});
   state.book=result.book;state.etag=result.etag;state.preview=null;
   state.project=source.projectId;state.notebook='all';state.selected=null;state.recordReturn=null;state.page='project';
   editing=base=deleting=null;document.querySelector('#dialog').close();render();notify('Lab book deleted.');
  }catch(error){
   const node=form.querySelector('[data-delete-error]');node.textContent=error.code==='CONFLICT'?'The workspace changed. Cancel and reload the workspace to review the latest contents before deleting.':error.message??t('labBookDirectory','deleteFailed');node.hidden=false;node.focus();
  }finally{deleteBusy=false;delete form.dataset.busy;form.querySelectorAll('button,select').forEach(n=>n.disabled=false);}
  return true;
 }
 async function action(node){
  if(await projects.action(node)||await profileLabels.action(node))return true;
  if(await configuration.action(node))return true;
  const a=node.dataset;
  if(a.action==='lab-book-delete'){
   capture();if(!editing||!state.book.notebooks.some(n=>n.id===editing.id))return true;
   deleting={id:editing.id,commandId:crypto.randomUUID(),records:recordCount(editing.id)?'':'empty',destinationId:null};deletionDialog();return true;
  }
  if(a.action==='lab-book-delete-cancel'){if(!deleteBusy){deleting=null;draw(true);}return true;}
  if(a.action==='notebook-config-command'){
   capture();
   if(a.command==='select-type')selected=a.id;
   else {const result=sectionAction(editing.configuration,a.command,a);if(result?.added)selected=result.added;}
   draw();return true;
  }
  if(['new-project','edit-project'].includes(a.action)){await projects.open(a.action==='edit-project'?a.id:null,a.action==='new-project'?a.id:null);return true;}
  if(['new-notebook','edit-notebook','rename-notebook','configure-lab-notebook','specialize-notebook'].includes(a.action)){
   if(!state.book.projects.length){notify('Create a project for this lab book first.');return true;}
   await openNotebook(a.action==='new-notebook'?null:a.id,a.action==='new-notebook'?a.id:null);return true;
  }
  return false;
 }
 function input(el){
  if(projects.input(el))return true;
  if(el.hasAttribute('data-lab-book-delete-records')){deleting.records=el.value;deletionDialog();document.querySelector('[data-lab-book-delete-records]')?.focus({preventScroll:true});return true;}
  if(el.closest('#lab-book-delete-form')){if(el.name==='destinationId')deleting.destinationId=el.value;return true;}
  if(!active())return false;
  if(native()&&configuration.input(el))return true;
  capture();
  if(creating&&el.hasAttribute('data-notebook-template')){templateChoice=el.value;followProjectDefault=templateChoice==='default';applyTemplate();draw();return true;}
  if(creating&&el.name==='projectId'){draw();return true;}
  if(el.hasAttribute('data-notebook-type')){selected=el.value;draw();return true;}
  if(el.dataset.notebookProfile){if(!enabledLabBookTypes(state.dashboardSettings).some(p=>p.id===el.dataset.notebookProfile))return true;enableProfile(editing.configuration,el.dataset.notebookProfile,el.checked);draw();return true;}
  if(sectionInput(el,editing.configuration)){if(['type','numericRepresentation'].includes(el.dataset.labFieldProp))draw();return true;}
  return false;
 }
 async function submit(form,data){
  if(form.id==='lab-book-delete-form')return confirmDeletion(form,data);
  if(['structure-project-form','project-template-form'].includes(form.id))return projects.submit(form);
  if(form.id!=='notebook-config-form')return false;
  let value,kind,expected;
  if(form.id==='notebook-config-form'){
   capture();value=structuredClone(editing);kind='notebook';expected=etag;
   if(!native()&&!validConfiguration(value.configuration)){const error=form.querySelector('[data-notebook-error]');error.textContent='Complete each type and field name; choice fields need distinct choices.';error.hidden=false;error.focus();return true;}
  }
  const errorNode=form.querySelector('[data-notebook-error]');errorNode.hidden=true;
  let result;
  try{
   let selectedConfiguration={};
   if(native()){
    if(creating){
     let source=null;
     if(templateChoice.startsWith('profile:'))source={profileId:templateChoice.slice(8)};
     else if(templateChoice==='default'||templateChoice.startsWith('project:')){const projectId=templateChoice==='default'?value.projectId:templateChoice.slice(8);const result=await sourceReader.open({workspaceId:state.book.id,projectId,notebookId:null,slot:'labBookTemplate'},{saved:true});source=result.configurationPin;}
     selectedConfiguration={configurationSource:source};
    }else selectedConfiguration=await configuration.checkpoint();
   }
   if(creating&&state.projectOwner){
    const result=await api('/api/projects/'+value.projectId+'/lab-books/create',{id:creationId,book:value,username:'',password:'',...selectedConfiguration},{adopt:false});
    await services.labBookDirectory.refresh(value.projectId);await services.enterProject(value.projectId,result.book.labBookId);
    state.project=value.projectId;state.notebook=result.book.labBookId;state.page='entries';state.search='';state.filter='all';state.recordBrowse=null;
    configuration.stop();sourceReader.stop();editing=base=null;document.querySelector('#dialog').close();render();notify('Lab book saved.');return true;
   }
   if(!creating&&state.projectOwner?.labBookId===value.id){
    result=await api('/api/projects/'+value.projectId+'/lab-books/'+value.id+'/settings/save',{id:creationId,etag:expected,book:value,...selectedConfiguration});
    await services.labBookDirectory.refresh(value.projectId);
   }else result=await api('/api/workspace/structure',{etag:expected,change:{kind,value},...selectedConfiguration});
  }
  catch(error){errorNode.textContent=error.code==='CONFLICT'?'The workspace changed. Your choices are still here. Keep any edits you need, then cancel and reload the workspace before trying again.':error.message??'Could not save this lab book. Your choices are still here.';errorNode.hidden=false;errorNode.focus();throw error;}
  state.book=result.book;state.etag=result.etag;
  configuration.stop();sourceReader.stop();editing=base=null;document.querySelector('#dialog').close();
  if(state.notebook===value.id)state.project=value.projectId;
  render();notify('Lab book saved.');return true;
 }
 return {directory,card,action,input,submit,attrs,route:notebookRoute,types:profileLabels.types,bind:profileLabels.bind,
  generalRecords:id=>recordsIn(state.book,id),isDirty:()=>isDirty()||projects.isDirty(),
  async save(){await projects.save();if(editing&&!active()){deleting=null;draw(true);}const form=active();if(form)await submit(form,new FormData(form));},
  async discard(){await projects.close();if(configuration.descriptor())await configuration.discard();configuration.stop();sourceReader.stop();editing=base=deleting=null;},async close(){await projects.close();if(configuration.descriptor())await configuration.discard();configuration.stop();sourceReader.stop();editing=base=deleting=null;}};
}
