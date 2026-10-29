import {moduleLabel,moduleProjectSettings,moduleLocationLabel} from './module-presentation.js';
import './i18n/catalogues/dashboardEditors.js';
import {t} from './i18n/index.js';
import {locationName} from './workspace-structure.js';
const dt=(key,parameters)=>t('dashboardEditors',key,parameters);


// Inline, workspace-specific adoption settings for any project-capable module.
export async function projectToolSettings(services,module){
 const {state,api,esc,draw,changed}=services,workspaceId=state.book.id;
 let snapshot,base=[],draft=[],pending=null,error='';
 const selections=book=>book.projects.filter(p=>p.tools?.includes(module.id)).map(p=>p.id).sort();
 const isDirty=()=>JSON.stringify(base)!==JSON.stringify([...draft].sort());
 async function activate(){
  if(isDirty())return;
  const result=await api('/api/notebook',undefined,{metadataOnly:true,adopt:false});
  if(isDirty())return;
  snapshot=result;base=selections(result.book);draft=[...base];
 }
 await activate();
 const button=(label,command)=>`<button type="button" class="button ${command==='save'?'primary':''}" data-action="module-settings-command" data-command="${command}" ${pending||!isDirty()?'disabled':''}>${label}</button>`;
 function view(){return `<div class="project-tool-settings"><h3>${esc(moduleProjectSettings(module)?.heading??(dt('projectsUsingTool',{name:moduleLocationLabel(module)})))}</h3>${moduleProjectSettings(module)?`<p><strong>${esc(snapshot.book.title)}</strong> · ${esc(moduleProjectSettings(module).intro)} <button type="button" class="text-button" data-action="module-open" data-module-id="${esc(module.id)}">${esc(moduleProjectSettings(module).openLabel)}</button></p>`:`<p>${esc(dt("projectToolHelp"))}</p>`}<fieldset ${pending?'disabled':''}><legend>${esc(dt("projects"))}</legend>${snapshot.book.projects.map(p=>`<label class="checkbox"><input type="checkbox" data-tool-project="${p.id}" ${draft.includes(p.id)?'checked':''}><span>${esc(locationName(snapshot.book,p.id))}</span></label>`).join('')||`<p>${esc(dt("createProjectForTool"))}</p>`}</fieldset><div class="module-actions">${button(esc(dt("saveChanges")),'save')}${button(esc(dt("discardChanges")),'discard')}<span role="status">${esc(error||(pending?dt("saving"):isDirty()?dt("unsavedChanges"):dt("saved")))}</span></div></div>`;}
 async function save(){
  if(pending)return pending;
  if(!isDirty())return;
  if(state.book.id!==workspaceId)throw new Error(dt("reopenProjectTools"));
  error='';
  pending=(async()=>{
   try{
    const result=await api('/api/workspace/structure',{etag:snapshot.etag,change:{kind:'project-tools',value:{moduleId:module.id,projectIds:[...draft]}}});
    snapshot=result;state.book=result.book;state.etag=result.etag;base=selections(result.book);draft=[...base];
   }catch(e){error=e.message;throw e;}
   finally{pending=null;services.render();changed?.();}
  })();
  draw();return pending;
 }
 async function discard(){if(pending)await pending;draft=[...base];error='';await activate();draw();changed?.();}
 return {view,activate,isDirty,save,discard,
  input(el){if(!el.hasAttribute('data-tool-project')||pending)return false;draft=draft.filter(id=>id!==el.dataset.toolProject);if(el.checked)draft.push(el.dataset.toolProject);error='';draw();document.querySelector('[data-tool-project="'+el.dataset.toolProject+'"]')?.focus({preventScroll:true});changed?.();return true;},
  async action(command){if(command==='save')await save();else if(command==='discard')await discard();}
 };
}
