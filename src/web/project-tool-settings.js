import {locationName} from './workspace-structure.js';

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
 function view(){return `<div class="project-tool-settings"><h3>${esc(module.projectSettings?.heading??('Projects using '+module.locationTool.label))}</h3>${module.projectSettings?`<p><strong>${esc(snapshot.book.title)}</strong> · ${esc(module.projectSettings.intro)} <button type="button" class="text-button" data-action="module-open" data-module-id="${esc(module.id)}">${esc(module.projectSettings.openLabel)}</button></p>`:'<p>Choose each project separately. Changes take effect when you save; existing data is kept.</p>'}<fieldset ${pending?'disabled':''}><legend>Projects</legend>${snapshot.book.projects.map(p=>`<label class="checkbox"><input type="checkbox" data-tool-project="${p.id}" ${draft.includes(p.id)?'checked':''}><span>${esc(locationName(snapshot.book,p.id))}</span></label>`).join('')||'<p>Create a project to use this tool there.</p>'}</fieldset><div class="module-actions">${button('Save changes','save')}${button('Discard changes','discard')}<span role="status">${esc(error||(pending?'Saving…':isDirty()?'Unsaved changes':'Saved'))}</span></div></div>`;}
 async function save(){
  if(pending)return pending;
  if(!isDirty())return;
  if(state.book.id!==workspaceId)throw new Error('Reopen this workspace before saving its project tools.');
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
