import {projectKindLabel} from './project-type-presentation.js';
import './i18n/catalogues/workspaceViews.js';
import {projectWorkspaceMoveRecoveryUI} from './project-workspace-move-recovery-ui.js';
import {projectRecentRecords} from './project-recent-records.js';
import {t} from './i18n/index.js';
import {projectDeletionUI} from './project-deletion-ui.js';
import {projectOpeningUI} from './project-opening-ui.js';
import {projectCreationRecoveryUI} from './project-creation-recovery-ui.js';
import {projectStorageUI} from './project-storage-ui.js';
import {locationToolsView,locationTools} from './modules/location-tools.js';
import {locationToolCounts} from './modules/location-tool-counts.js';
import {ancestors,childrenOf,locationName} from './workspace-structure.js';
import {projectNotebooksUI} from './project-notebooks.js';
import {createDataSession,workspaceData} from './data-registry.js';
import {defaultPanelConfig} from './dashboard-model.js';
import { identityFields, identityFromForm } from './workspace-identity.js';
export function workspaceUI({state,api,esc,field,option,icon,dirty,save,render,showDialog,notify,recordsTable,logosFor,isUploading,projectDirectory,labBookDirectory,accessProject,enterProject,rootBook,renameWorkspace}) {
  const text=(key,parameters)=>esc(t('workspaceViews',key,parameters));
  const projectOpening=projectOpeningUI({state,api,esc,field,showDialog,refreshDirectory:()=>projectDirectory.refresh(),enterProject,render});
  const projectCreation=projectCreationRecoveryUI({state,api,esc,field,showDialog,refreshDirectory:()=>projectDirectory.refresh()});
  const projectDeletion=projectDeletionUI({state,api,accessProject,esc,field,showDialog,enterProject,render,refreshDirectory:()=>projectDirectory.refresh()});
  const projectMoves=projectWorkspaceMoveRecoveryUI({state,api,esc,field,accessProject,refreshDirectory:()=>projectDirectory.refresh()});
  const projectStorage=projectStorageUI({state,api,esc,field,showDialog,accessProject,projectDirectory,rootBook,projectRoot:id=>projectDirectory.entries().find(entry=>entry.projectId===id)?.root,deleteProject:entry=>projectDeletion.confirm(entry),moved:async(result,targetPath)=>{await enterProject(null);state.page='projects';state.project=null;location.hash='#/projects';projectMoves.completed(result,targetPath);render();}});
  const labNotebooks=projectNotebooksUI({state,api,esc,field,option,showDialog,render,notify,projectDirectory,labBookDirectory,accessProject,enterProject,rootBook});
  const ownedRecent=projectRecentRecords({state,api,access:accessProject,esc,table:recordsTable});
  const toolCounts=locationToolCounts({state,api,esc});
  const notebooks = id => state.book.notebooks.filter(n => n.projectId === id);
  const records = id => labNotebooks.generalRecords(id);
 const recordCount=id=>notebooks(id).reduce((total,n)=>total+((state.workspaceOutline?.notebookCounts??state.recordScope?.notebookCounts)?.[n.id]??state.book.entries.filter(e=>e.notebookId===n.id).length),0);
  let recentSession=null,recentContext=null;
  const recentActive=()=>state.page==='project'&&state.workspaceOutline&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace;
  const recentContextId=()=>JSON.stringify([state.storage?.contextId,state.book?.id,projectDirectory.entries().find(entry=>entry.projectId===state.projectOwner?.projectId)?.root??null]);
  function bind(){labNotebooks.bind();ownedRecent.bind();projectStorage.bind();toolCounts.bind();if(recentSession&&(!recentActive()||recentContext!==recentContextId())){recentSession.close();recentSession=null;recentContext=null;}}
  function recentRecords(id){
    if(state.projectOwner&&!state.projectOwner.labBookId)return ownedRecent.view();
    if(!state.workspaceOutline)return recordsTable(records(id).sort((a,b)=>(b.updatedAt??b.occurredOn).localeCompare(a.updatedAt??a.occurredOn)).slice(0,10));
    bind();if(!recentSession){recentContext=recentContextId();recentSession=createDataSession(workspaceData,{api,onChange:()=>{const host=document.getElementById('project-recent-records');if(recentActive()&&host)host.innerHTML=recentRecords(state.project);}});}
    const context={book:state.book,etag:state.etag,outline:true,legacyConfig:defaultPanelConfig(),recordLimit:10,recordKey:null,dataSlot:'project-recent'};
    const result=recentSession.read('records',context,{scopeMode:'selected',projectIds:[id],includeDescendants:true,includeWorkspace:false});
    if(result.status==='loading')return `<p role="status">${text('recentLoading')}</p>`;
    if(result.status!=='ready')return '<p role="alert">'+esc(result.error?.message||t('workspaceViews','recentFailed'))+`</p><button class="button" data-action="project-recent-retry">${text('recentRetry')}</button>`;
    return recordsTable(result.items.map(item=>item.data));
  }
  function recordContext() {
    const project=state.book.projects.find(p=>p.id===state.project),notebook=state.book.notebooks.find(n=>n.id===state.notebook),parts=[];
    if(project)parts.push(`<span><small>${esc(projectKindLabel(project.kind))}</small> <button data-action="open-project" data-id="${project.id}">${esc(locationName(projectDirectory.navigation(state.book),project.id))}</button></span>`);
    if(notebook&&['editor','record-reader'].includes(state.page)){
      parts.push(`<span><small>${text('labBook')}</small> <button data-action="filter-notebook" data-id="${notebook.id}">${esc(notebook.title)}</button></span>`);
    }
    return parts.length?`<nav class="location-trail record-context research-location" aria-label="${text('hierarchy')}">${parts.join('<span aria-hidden="true">/</span>')}</nav>`:'';
  }

  function projectCard(p) {
    const list=labNotebooks.directory(p.id);
    return `<article class="project-card"><span class="scope-kicker">${esc(projectKindLabel(p.kind))}</span><h2><button class="card-title" data-action="open-project" data-id="${p.id}">${esc(p.title)}</button></h2>${p.description?'<p>'+esc(p.description)+'</p>':''}
     <ul class="notebook-directory">${list.map(n=>`<li><button ${labNotebooks.attrs(n.route)}><strong>${esc(n.title)}</strong><small>${text('recordCount',{count:n.count})}</small></button></li>`).join('')||`<li class="muted">${text('noBooks')}</li>`}</ul>
     <div class="inline-actions"><button class="button" data-action="open-project" data-id="${p.id}">${text('open')}</button><button class="button" data-action="edit-project" data-id="${p.id}">${text('settings')}</button></div></article>`;
  }
  function overview() {
    const b=state.book;
    return `<div class="page-heading overview-heading"><div><h1>${text('projects')}</h1>${b.description?`<p class="subtitle">${esc(b.description)}</p>`:''}</div><div class="inline-actions">${projectOpening.button()}<button class="button primary" data-action="new-project">${icon('plus')}${text('newProject')}</button></div></div>
      ${projectOpening.view()}${projectCreation.view()}${projectMoves.view()}${projectDeletion.view()}${locationToolsView(state,null,esc)}${b.projects.length?`<div class="project-grid">${childrenOf(b).map(projectCard).join('')}</div>`:''}${projectDirectory.cards(null)}`;
  }

  function projectView() {
    const p=state.book.projects.find(p=>p.id===state.project);if(!p)return overview();
    const ns=labNotebooks.directory(p.id),hierarchy=projectDirectory.navigation(state.book);
    return `${state.projectOwner?projectDirectory.trail(p.id,rootBook().title):`<nav class="location-trail" aria-label="${text('hierarchy')}"><button class="text-button" data-action="projects">${esc(rootBook().title)}</button>${ancestors(hierarchy,p.id).slice(0,-1).map(parent=>` / <button class="text-button" data-action="open-project" data-id="${parent.id}">${esc(parent.title)}</button>`).join('')}</nav>`}<div class="page-heading"><div><span class="scope-kicker">${esc(projectKindLabel(p.kind))}</span><h1>${esc(p.title)}</h1>${p.description?'<p class="subtitle">'+esc(p.description)+'</p>':''}</div><button class="button" data-action="edit-project" data-id="${p.id}">${text('settings')}</button></div>
     ${projectStorage.view()}${locationToolsView(state,p.id,esc)}<div class="section-bar"><h2>${text('inside',{name:p.title})}</h2><button class="button" data-action="new-project" data-id="${p.id}">${text('newSubproject')}</button></div>${childrenOf(state.book,p.id).length?`<div class="project-grid">${childrenOf(state.book,p.id).map(projectCard).join('')}</div>`:''}${state.projectOwner?projectDirectory.cards(p.id):''}
     <div class="section-bar"><h2>${text('labBooks')}${state.projectOwner?'':' <span class="badge">'+ns.length+'</span>'}</h2><div class="inline-actions"><button class="button" data-action="edit-project-template" data-id="${p.id}">${text('bookTemplate')}</button><button class="button primary" data-action="new-notebook" data-id="${p.id}">${icon('plus')}${text('newBook')}</button></div></div>
     ${state.projectOwner?labBookDirectory.view(p.id):'<div class="notebook-grid">'+(ns.map(labNotebooks.card).join('')||`<p class="muted">${text('createBookHelp')}</p>`)+'</div>'}
     <div class="section-bar"><h2>${text('recentRecords')}</h2><button class="button" data-action="project-records" data-id="${p.id}">${text('allRecords')}</button></div><div id="project-recent-records" aria-live="polite">${recentRecords(p.id)}</div>`;
  }
function generalPreferences(){
 const b=state.book;
 return `<form id="workspace-name-form" class="panel general-preferences"><h2>${text('details')}</h2>${state.storage?.nameConflict?`<p role="alert">${esc(t('workspaceNaming','conflict'))}</p>`:''}<p class="muted">${text('detailsHelp')}</p><div class="form-grid">${field(text('name'),`<input name="title" required maxlength="160" value="${esc(b.title)}">`)}<div>${identityFields({field,option,esc},b.identity)}</div></div>${field(text('introduction'),`<textarea name="description" rows="3" maxlength="1500">${esc(b.description)}</textarea>`)}<div class="section-save"><span data-workspace-status role="status">${text('saved')}</span><div class="inline-actions"><button type="button" class="button" data-action="workspace-discard" disabled>${text('discard')}</button><button type="submit" class="button primary" disabled>${text('save')}</button></div></div></form><details class="panel workspace-reference"><summary>${text('referenceTitle')}</summary><p class="muted">${text('referenceHelp')}</p><button class="button" data-action="research-copy-context" data-kind="workspace">${text('copyReference')}</button><button class="button" data-action="workspace-reorganize">${esc(t('workspaceNaming','copyToProject'))}</button></details>`;
}

  async function action(button) {
    if(await ownedRecent.action(button))return true;
    const name=button.dataset.action;
    if(name==='location-counts-retry'){toolCounts.retry();return true;}
    if(name==='project-recent-retry'){recentSession?.retry('records');return true;}
    if(name==='workspace'){state.page='workspace';state.project=null;state.notebook='all';render();return true;}
    if(name==='open-project'||name==='project-records') {state.page=name==='open-project'?'project':'entries';state.project=button.dataset.id;state.notebook='all';state.search='';state.filter='all';state.recordBrowse=null;render();return true;}
    if(name==='workspace-reorganize') {
      const native=state.storage?.researchStorage==='catalogue',create=native?`<p>${text('newProjectHelp')}</p><button type="button" class="button primary" data-action="new-project" data-copy-workspace-details>${text('createProject')}</button>`:'';
      if(native&&!state.book.projects.length){showDialog('<div><h2 id="dialog-title">'+esc(t('workspaceNaming','copyToProject'))+'</h2>'+create+`<div class="dialog-actions"><button class="button" data-action="close-dialog">${text('cancel')}</button></div></div>`);return true;}
      showDialog(`<form id="workspace-organize-form"><h2 id="dialog-title">${esc(t('workspaceNaming','copyToProject'))}</h2>${create}<p>${esc(t('workspaceNaming','copyToProjectDescription',{name:state.book.title}))}</p>${field(`${text('newIntroduction')} <small>${text('optional')}</small>`,'<textarea name="workspaceDescription" maxlength="1500" rows="2"></textarea>')}${field(text('destinationProject'),`<select name="projectId">${state.book.projects.map(p=>option(p.id,t('workspaceViews','projectChoice',{title:p.title,books:notebooks(p.id).length,records:recordCount(p.id)}),state.book.projects[0]?.id)).join('')}${native?'':option('new',t('workspaceViews','createProject'),null)}</select>`)}<p class="muted">${text('organizeHelp')}</p><label class="checkbox"><input name="copyLogos" type="checkbox"><span>${text('copyLogos')}</span></label><div class="dialog-actions"><button class="button" type="button" data-action="close-dialog">${text('cancel')}</button><button class="button primary" type="submit">${text('review')}</button></div></form>`);return true;
    }
    return false;
  }
  function accept(result){state.book=result.book;state.etag=result.etag;state.dirty=false;state.preview=null;}
  async function submit(form,data) {
    if(!['workspace-name-form','workspace-organize-form','workspace-organize-confirm'].includes(form.id))return false;
    if(isUploading()){notify(t('workspaceViews','uploadPending'),true);return true;}
    if(form.id==='workspace-name-form') {
      const title=data.get('title');if(!title){notify(t('workspaceViews','nameRequired'),true);return true;}
      state.book.identity=identityFromForm(data);state.book.description=data.get('description');dirty();await save();if(state.dirty)return true;if(title!==state.book.title&&!await renameWorkspace(title))return true;document.querySelector('#dialog').close();render();notify(t('workspaceViews','detailsSaved'));return true;
    }
    await save(); if(state.dirty){notify(t('workspaceViews','saveBeforeOrganizing'),true);return true;}
    if(form.id==='workspace-organize-form') {
      const change={workspaceTitle:state.book.title,workspaceDescription:data.get('workspaceDescription'),projectId:data.get('projectId'),copyLogos:data.has('copyLogos')};
      const plan=await api('/api/workspace/reorganize/preview',{etag:state.etag,change});state.reorganization={etag:plan.etag,change};
      const p=plan.summary;
      showDialog(`<form id="workspace-organize-confirm"><h2 id="dialog-title">${text('reviewHierarchy')}</h2><dl class="result-details"><dt>${text('workspace')}</dt><dd>${esc(p.workspaceTitle)}</dd><dt>${text('project')}</dt><dd>${p.created?text('create'):text('renameTo',{name:p.previousTitle})} <strong>${esc(p.projectTitle)}</strong></dd><dt>${text('contents')}</dt><dd>${text('contentsCount',{books:p.notebooks,records:p.records})}</dd><dt>${text('logos')}</dt><dd>${p.copyLogos?text('copyLogosSummary'):text('keepLogos')}</dd></dl><p class="muted">${text('preserveContent')}</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">${text('cancel')}</button><button type="submit" class="button primary">${text('applyHierarchy')}</button></div></form>`);return true;
    }
    if(form.id==='workspace-organize-confirm') {
      const result=await api('/api/workspace/reorganize',{...state.reorganization,reviewed:true});accept(result);state.reorganization=null;state.page='workspace';state.project=null;state.notebook='all';

    }
    document.querySelector('#dialog').close();render();notify(t('workspaceViews','structureSaved'));return true;
  }
  return {projectOpening,projectCreation,projectMoves,projectDeletion,projectStorage,bind,recordContext,overview,projectView,generalPreferences,action,submit,notebooks:labNotebooks};
}
