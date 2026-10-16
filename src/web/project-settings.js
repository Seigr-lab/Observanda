import {projectDirectoryChoices} from './project-directory-choices.js';
import {localizedText} from './i18n/index.js';
const projectText=localizedText('projectDirectory');
import {availableLocationTools} from './modules/location-tools.js';
import {enabledLabBookTypes} from './feature-modules.js';
import {emptyConfiguration} from './notebook-schema.js';
import {projectTypeChoices,projectTypeChoice,recommendedProfile,starterTemplate,copyConfiguration,templateChoices,templateAvailable,validLabBookTemplate} from './project-templates.js';
import {locationName,descendants} from './workspace-structure.js';
import {sectionDetails,sectionInput,sectionAction} from './laboratory/section-editor.js';

export function projectSettings(services){
 const {state,api,esc,field,option,showDialog,render,notify}=services;
 let placementRequest=null,saveRequest=null,creation=null,creationBase=null,remoteTemplates=new Map(),placementParent=null;
 let draft=null,base=null,etag=null,mode='project',type='none',source='blank',selected=null,templateChosen=false,busy=false,error='',replace=false;
 const form=()=>document.querySelector('#dialog[open] #'+(mode==='template'?'project-template-form':'structure-project-form'));
 const directoryChoices=projectDirectoryChoices({state,api,esc,changed:paintChoices});
 const button=(label,command,attrs='',style='')=>`<button type="button" class="button ${style}" data-action="project-template-command" data-command="${command}" ${attrs}>${esc(label)}</button>`;
 function capture(){
  const f=form();if(!f||!draft||busy)return;
  if(mode==='template'){if(draft.labBookTemplate&&f.elements.templateName)draft.labBookTemplate.name=f.elements.templateName.value;return;}
  draft.title=f.elements.title.value;draft.description=f.elements.description.value;if(f.elements.parentId&&(creation||!state.projectOwner))draft.parentId=f.elements.parentId.value||null;
  if(creation){creation.username=f.elements.projectUsername.value;creation.password=f.elements.projectPassword.value;}
  draft.kind=type==='none'?'Project':type==='custom'?f.elements.customKind.value:projectTypeChoices(state.dashboardSettings).find(c=>c.id===type)?.label??draft.kind;
  const available=new Set(availableLocationTools(state.dashboardSettings).map(m=>m.id));
  draft.tools=[...(draft.tools??[]).filter(id=>!available.has(id)),...new FormData(f).getAll('projectTool')];
 }
 const isDirty=()=>{capture();return !!draft&&(JSON.stringify(draft)!==JSON.stringify(base)||JSON.stringify(creation)!==JSON.stringify(creationBase));};
 function parentOptions(value=creation?draft.parentId??'':placementParent??''){
  const entries=services.projectDirectory.entries(),blocked=descendants(services.projectDirectory.navigation(state.book),draft.id),rows=directoryChoices.rows('parents',entries).filter(entry=>!blocked.has(entry.projectId));
  if(value&&!rows.some(entry=>entry.projectId===value))rows.unshift(directoryChoices.known(value)??entries.find(entry=>entry.projectId===value)??{projectId:value,summary:null});
  return option('',services.rootBook().title,value)+rows.map(entry=>option(entry.projectId,entry.summary?.title??entry.projectId,value)).join('');
 }
 function sourceOptions(){
  const profiles=enabledLabBookTypes(state.dashboardSettings),query=directoryChoices.query('templates').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en'),matches=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en').includes(query);
  const local=templateChoices(state.book,state.dashboardSettings).filter(t=>t.id!==draft.id),templates=local.filter(t=>matches(t.label));
  for(const entry of directoryChoices.rows('templates',services.projectDirectory.entries()))if(entry.projectId!==draft.id&&entry.summary?.templateName&&!templates.some(t=>t.id===entry.projectId))templates.push({id:entry.projectId,label:entry.summary.templateName+' / '+entry.summary.title});
  const selectedId=source.startsWith('project:')?source.slice(8):null;
  if(selectedId&&!templates.some(t=>t.id===selectedId)){
   const localChoice=local.find(t=>t.id===selectedId),entry=directoryChoices.known(selectedId)??services.projectDirectory.entries().find(t=>t.projectId===selectedId);
   templates.unshift(localChoice??{id:selectedId,label:entry?.summary?.templateName?entry.summary.templateName+' / '+entry.summary.title:remoteTemplates.get(selectedId)?.name??selectedId});
  }
  return (mode==='template'?option('choose','Choose a starting template',source):'')+option('blank',mode==='template'?'Blank custom template':'No default template',source)+
   (mode==='project'&&base.labBookTemplate?option('current','Saved default: '+base.labBookTemplate.name,source):'')+
   (profiles.length?'<optgroup label="Lab-book types">'+profiles.map(p=>option('profile:'+p.id,p.label,source)).join('')+'</optgroup>':'')+
   (templates.length?'<optgroup label="Saved project templates">'+templates.map(t=>option('project:'+t.id,t.label,source)).join('')+'</optgroup>':'');
 }
 function paintChoices(kind){
  const target=form();if(!target||!draft)return;capture();
  const select=target.querySelector(kind==='parents'?'[name="parentId"]':'[data-project-template-source]');
  if(select)select.innerHTML=kind==='parents'?parentOptions(select.value):sourceOptions();
  directoryChoices.paint(target,kind);
 }
 function summary(){
  const template=draft.labBookTemplate;
  if(!template)return '<p>New lab books will start blank. You can create a custom template from the project after saving.</p>';
  const sections=template.configuration.sections.filter(s=>s.enabled);
  return '<p>Included record types</p><ul class="project-template-summary">'+sections.map(s=>'<li><strong>'+esc(s.label)+'</strong><span>'+s.fields.length+' fields</span></li>').join('')+'</ul>'+
   (!sections.length?'<p>Free-form records; no additional record types.</p>':'')+
   (!templateAvailable(template,state.dashboardSettings)?'<p>The saved default uses a type that is turned off. Enable it in Preferences to use it for new lab books.</p>':'')+
   '<p>Each new lab book gets its own copy. To edit this template, open Lab-book template from the saved project.</p>';
 }
 function templateFields(){
  const template=draft.labBookTemplate,c=template?.configuration,choices=c?.sections??[];
  if(!choices.some(s=>s.id===selected))selected=choices.find(s=>s.enabled)?.id??choices[0]?.id;
  const section=choices.find(s=>s.id===selected),index=choices.indexOf(section),siblings=choices.filter(s=>s.enabled&&s.profileId===section?.profileId),position=siblings.indexOf(section);
  return '<p>Default template for <strong>'+esc(draft.title)+'</strong>. Changes apply to new lab books. Existing lab books and records keep their own contents.</p>'+
   '<div class="project-template-source">'+field('Starting template','<select data-project-template-source>'+sourceOptions()+'</select>'+directoryChoices.view('templates'))+button('Use template','apply',source==='choose'?'disabled':'')+'</div>'+
   '<p class="muted">Choose more types in Preferences &rarr; Modules &rarr; Lab-book types.</p>'+
   (replace?'<div class="project-template-confirm" role="alert"><p>Replace this template draft?</p>'+button('Replace template','replace')+button('Keep template','keep')+'</div>':'')+
   (!template?'<p>No default template. Choose a starting template to create one.</p>':
    field('Template name','<input name="templateName" required maxlength="160" value="'+esc(template.name)+'">')+
    '<div class="lab-type-layout"><aside class="lab-type-catalogue" aria-label="Record types"><div class="lab-type-list-heading"><strong>Record types ('+choices.length+')</strong>'+button('Add record type','section-add','','subtle')+'</div><div class="lab-type-list">'+
    choices.map(s=>'<button type="button" class="lab-type-choice" data-action="project-template-command" data-command="select-type" data-id="'+s.id+'" aria-current="'+(s.id===selected)+'"><span data-type-title>'+esc(s.label)+'</span><small>'+(s.enabled?s.fields.length+' fields':'Removed')+'</small></button>').join('')+
    '</div></aside><section class="lab-type-detail" aria-label="Selected record type">'+(section?
     '<div class="lab-type-detail-heading"><strong>'+(section.enabled?'Type details':'Removed type')+'</strong><div>'+button('Move up','section-move','data-index="'+index+'" data-direction="-1" '+(position<=0?'disabled':''),'subtle')+button('Move down','section-move','data-index="'+index+'" data-direction="1" '+(position<0||position>=siblings.length-1?'disabled':''),'subtle')+button(section.enabled?'Remove type':'Restore type',section.enabled?'section-remove':'section-restore','data-index="'+index+'"','subtle')+'</div></div>'+sectionDetails(section,index,{field,esc,option,button}):'<p>Add a record type to define its fields and guidance.</p>')+
    '</section></div><div class="inline-actions">'+button('Remove default template','remove','','subtle')+'</div>');
 }
 function projectFields(){
  const blocked=descendants(services.projectDirectory.navigation(state.book),draft.id),tools=availableLocationTools(state.dashboardSettings);
  return field('Name','<input name="title" value="'+esc(draft.title)+'" required maxlength="160">')+
   '<div class="form-grid">'+field('Project type','<select data-project-type>'+option('none','No type selected',type)+projectTypeChoices(state.dashboardSettings).map(c=>option(c.id,c.label,type)).join('')+option('custom','Custom type',type)+'</select>')+
   (creation||state.projectOwner?field(projectText('inside'),'<select name="parentId" '+(state.projectOwner&&!creation?'data-project-parent':'')+'>'+parentOptions()+'</select>'+directoryChoices.view('parents')):field('Inside','<select name="parentId">'+option('',state.book.title,draft.parentId??'')+state.book.projects.filter(p=>!blocked.has(p.id)).map(p=>option(p.id,locationName(state.book,p.id),draft.parentId)).join('')+'</select>'))+'</div>'+
   (creation?'<div class="form-grid">'+field(projectText('username')+' <small>'+esc(projectText('passwordHint'))+'</small>','<input name="projectUsername" autocomplete="off" value="'+esc(creation.username)+'">')+field(projectText('password')+' <small>'+esc(projectText('passwordHint'))+'</small>','<input name="projectPassword" type="password" autocomplete="new-password" value="'+esc(creation.password)+'">')+'</div>':'')+
   (type==='custom'?field('Custom project type','<input name="customKind" required maxlength="80" value="'+esc(draft.kind)+'">'):'')+
   field('Description','<textarea name="description" rows="2" maxlength="1500">'+esc(draft.description)+'</textarea>')+
   '<section class="project-template-panel" aria-label="Template selection">'+field('Default lab-book template','<select data-project-template-source>'+sourceOptions()+'</select>'+directoryChoices.view('templates'))+summary()+'<p class="muted">Enable more types in Preferences &rarr; Modules &rarr; Lab-book types.</p></section>'+
   (tools.length?'<fieldset class="project-tool-choices"><legend>Project tools</legend>'+tools.map(m=>'<label class="checkbox"><input type="checkbox" name="projectTool" value="'+m.id+'" '+(draft.tools?.includes(m.id)?'checked':'')+'>'+esc(m.locationTool.label)+'</label>').join('')+'</fieldset>':'');
 }
 function draw(focus){
  const scroll=form()?.querySelector('.project-config-scroll')?.scrollTop??0,current=state.book.projects.some(p=>p.id===draft.id),template=mode==='template';
  showDialog('<form id="'+(template?'project-template-form':'structure-project-form')+'" data-no-draft class="project-config-form '+(template?'project-template-form':'')+'" '+(busy?'data-busy="true" aria-busy="true"':'')+'><h2 id="dialog-title">'+(template?'Lab-book template':current?'Edit project':'New project')+'</h2>'+
   '<div class="project-config-scroll"><fieldset class="project-config-fields" '+(busy?'disabled':'')+'>'+(template?templateFields():projectFields())+'</fieldset></div>'+
   (busy&&creation?'<p role="status">'+esc(projectText('creating'))+'</p>':'')+'<p class="module-error" role="alert" tabindex="-1" data-project-error '+(error?'':'hidden')+'>'+esc(error)+'</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog" '+(busy?'disabled':'')+'>Cancel</button><button class="button primary" '+(busy?'disabled':'')+'>'+ (template?'Save template':creation?projectText('create'):'Save project')+'</button></div></form>');
  form().querySelector('.project-config-scroll').scrollTop=scroll;directoryChoices.paint(form(),'parents');directoryChoices.paint(form(),'templates');
  if(focus)form().querySelector(focus)?.focus({preventScroll:true});
 }
 function open(id,parentId,editingTemplate=false){
  const current=state.book.projects.find(p=>p.id===id);if(editingTemplate&&!current)return;
  if(!current&&parentId&&!services.projectDirectory.entries().some(entry=>entry.projectId===parentId))throw new Error(projectText('legacyParent'));
  directoryChoices.reset();saveRequest=null;remoteTemplates=new Map();creation=current?null:{id:crypto.randomUUID(),username:'',password:''};creationBase=structuredClone(creation);
  placementParent=current&&state.projectOwner?services.projectDirectory.entries().find(entry=>entry.projectId===current.id)?.parentId??null:null;
  mode=editingTemplate?'template':'project';
  draft=structuredClone(current??{id:crypto.randomUUID(),title:'',description:'',share:false,logoId:null,parentId:parentId??null,kind:'Project'});
  draft.tools??=[];draft.kind??='Project';
  if(editingTemplate&&!draft.labBookTemplate)draft.labBookTemplate={name:'',configuration:emptyConfiguration()};
  base=structuredClone(draft);etag=state.etag;type=projectTypeChoice(draft.kind,state.dashboardSettings);
  source=editingTemplate?'choose':draft.labBookTemplate?'current':'blank';templateChosen=!!current;selected=null;busy=false;error='';replace=false;draw(editingTemplate?'[name="templateName"]':'[name="title"]');directoryChoices.start(draft.id,{parents:!editingTemplate&&!!(creation||state.projectOwner)});
 }
 function apply(){
  if(source==='choose')return;
  if(source==='current'){draft.labBookTemplate=structuredClone(base.labBookTemplate);return;}
  const profile=recommendedProfile(source,state.dashboardSettings);
  if(source.startsWith('profile:')&&!profile)throw new Error('Enable this type in Preferences / Modules / Lab-book types first.');
  const existing=source.startsWith('project:')?(state.book.projects.find(p=>p.id===source.slice(8))?.labBookTemplate??remoteTemplates.get(source.slice(8))):null;
  if(source.startsWith('project:')&&!templateAvailable(existing,state.dashboardSettings))throw new Error('This project template is no longer available.');
  if(source==='blank'&&mode==='project')delete draft.labBookTemplate;
  else draft.labBookTemplate=profile?starterTemplate(profile.id):existing?{name:existing.name,configuration:copyConfiguration(existing.configuration)}:{name:'',configuration:emptyConfiguration()};
  selected=null;replace=false;
 }
 async function action(node){
  if(await directoryChoices.action(node))return true;
  if(node.dataset.action==='edit-project-template'){open(node.dataset.id,null,true);return true;}
  if(node.dataset.action!=='project-template-command'||mode!=='template'||!draft)return false;
  if(busy)return true;capture();error='';const command=node.dataset.command;
  if(command==='apply'&&draft.labBookTemplate){replace=true;draw('[data-command="replace"]');return true;}
  if(command==='apply'||command==='replace'){
   busy=true;draw();try{await apply();}catch(e){error=e?.message??'Could not load this template. Your edits are still here.';}finally{busy=false;draw('[name="templateName"]');}return true;
  }
  if(command==='keep')replace=false;
  else if(command==='remove'){delete draft.labBookTemplate;replace=false;}
  else if(command==='select-type')selected=node.dataset.id;
  else if(draft.labBookTemplate){
   if(!sectionAction(draft.labBookTemplate.configuration,command,node.dataset))return true;
   const c=draft.labBookTemplate.configuration;if(command==='section-add')selected=c.sections.at(-1).id;
  }
  draw(['section-add','select-type'].includes(command)?'[data-lab-section-prop="label"]':undefined);return true;
 }
 async function changePlacement(element){
  const id=draft.id,parentId=element.value||null,expectedParentId=placementParent,signature=JSON.stringify({id,parentId,expectedParentId});if(placementRequest?.signature!==signature)placementRequest={id:crypto.randomUUID(),signature};const requestId=placementRequest.id;element.disabled=true;
  try{await services.accessProject(()=>api('/api/projects/'+id+'/directory/reparent',{id:requestId,parentId,expectedParentId},{adopt:false}));placementRequest=null;if(draft?.id===id)placementParent=parentId;await services.projectDirectory.refresh();}
  catch(e){if(e.name==='AbortError'){if(draft?.id===id)element.value=placementParent??'';return;}const message=e.message??projectText('placementFailed');if(draft?.id===id&&form()){error=message;element.value=placementParent??'';draw('[data-project-error]');}else notify(message,true);}
  finally{element.disabled=false;if(draft?.id===id){if(!form())draw('[name=parentId]');const current=form()?.querySelector('[data-project-parent]');if(current)current.disabled=false;}}
 }
 async function loadTemplate(choice){
  const id=draft.id;busy=true;draw();
  try{
   const result=await services.accessProject(()=>api('/api/projects/'+choice.slice(8)+'/workspace/read/start',{}, {adopt:false}));
   if(draft?.id!==id||source!==choice)return;
   const template=result.metadata.projects.find(p=>p.id===choice.slice(8))?.labBookTemplate;
   if(!validLabBookTemplate(template)||!templateAvailable(template,state.dashboardSettings))throw new Error(projectText('templateUnavailable'));
   remoteTemplates.set(choice.slice(8),template);if(mode==='project'){templateChosen=true;apply();}
  }catch(e){if(draft?.id===id)error=e.message??projectText('templateUnavailable');}
  finally{busy=false;if(draft?.id===id)draw(error?'[data-project-error]':'[data-project-template-source]');}
 }
 function input(el){
  if(!form()?.contains(el))return false;if(busy)return true;if(directoryChoices.input(el))return true;if(el.hasAttribute('data-project-parent')){void changePlacement(el);return true;}capture();error='';
  if(el.hasAttribute('data-project-type')){
   type=el.value;draft.kind=type==='none'?'Project':type==='custom'?'':projectTypeChoices(state.dashboardSettings).find(c=>c.id===type).label;
   if(!templateChosen){source=recommendedProfile(type,state.dashboardSettings)?type:'blank';apply();}
   draw(type==='custom'?'[name="customKind"]':'[data-project-type]');
  }else if(el.hasAttribute('data-project-template-source')){source=el.value;replace=false;if(source.startsWith('project:')&&!state.book.projects.some(p=>p.id===source.slice(8))&&!remoteTemplates.has(source.slice(8))){void loadTemplate(source);return true;}if(mode==='project'){templateChosen=true;apply();}draw('[data-project-template-source]');}
  else if(mode==='template'&&draft.labBookTemplate&&sectionInput(el,draft.labBookTemplate.configuration)){if(el.dataset.labSectionProp==='label'){const title=form().querySelector('[data-id="'+selected+'"] [data-type-title]');if(title)title.textContent=el.value;}if(['type','numericRepresentation'].includes(el.dataset.labFieldProp))draw('[data-lab-field="'+el.dataset.labField+'"][data-lab-field-prop="'+el.dataset.labFieldProp+'"]');}
  return true;
 }
 async function submit(target){
  if(!['structure-project-form','project-template-form'].includes(target.id))return false;if(busy)return true;capture();
  if(draft.labBookTemplate&&!validLabBookTemplate(draft.labBookTemplate)){error='Enter a template name and complete each record type and field. Choice fields need distinct choices.';draw('[data-project-error]');throw new Error(error);}
  busy=true;error='';const value=structuredClone(draft);value.title=value.title.trim();value.kind=value.kind.trim();draw();
  try{
   if(creation){await api('/api/projects/create',{...creation,project:value},{adopt:false});if(creation.password)await api('/api/projects/'+value.id+'/access/unlock',{username:creation.username,password:creation.password,recovery:''},{adopt:false});await services.enterProject(value.id);await services.projectDirectory.refresh();}
   else{const signature=JSON.stringify({etag,project:value});if(saveRequest?.signature!==signature)saveRequest={id:crypto.randomUUID(),signature};const result=state.projectOwner?await services.accessProject(()=>api('/api/projects/'+value.id+'/settings/save',{id:saveRequest.id,etag,project:value})):await api('/api/workspace/structure',{etag,change:{kind:'project',value}});state.book=result.book;state.etag=result.etag;if(state.projectOwner)await services.projectDirectory.refresh();}
   state.preview=null;state.project=value.id;state.notebook='all';state.page='project';
   form()?.removeAttribute('data-busy');form()?.removeAttribute('aria-busy');directoryChoices.reset();draft=base=creation=creationBase=null;document.querySelector('#dialog').close();render();notify(mode==='template'?'Template saved.':'Project saved.');
  }catch(e){error=e.code==='CONFLICT'?'The workspace changed. Your edits are still here. Keep any edits you need, then cancel and reload the workspace before trying again.':e?.message??'Could not save. Your edits are still here.';busy=false;draw('[data-project-error]');if(e.code==='ACCESS_LOCKED')throw e;throw new Error(error,{cause:e});}
  finally{busy=false;}
  return true;
 }
 return {open,action,input,submit,isDirty,save:async()=>{if(draft){if(!form())draw();if(!form().reportValidity())throw new Error('Complete the required project fields.');await submit(form());}},close:()=>{if(!busy){directoryChoices.reset();draft=base=creation=creationBase=null;}}};
}
