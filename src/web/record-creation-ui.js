import {ux} from './experience-ui.js';
import {configurationTypeChoices} from './configuration-type-choices.js';
import {configurationOf} from './notebook-schema.js';
import {availableSections,laboratoryModuleId} from './laboratory/catalog.js';
import {enabledModule} from './feature-modules.js';
import {RECORD_TYPES} from './record-types.js';
import {recordTypePresentation} from './record-type-presentation.js';
import {t,messageLanguage} from './i18n/index.js';

export function recordCreationUI({state,api,notebooks,esc,showDialog,locationName,create}){
 const selected=configurationTypeChoices({state,api,esc,showDialog});
 const text=(key,parameters)=>esc(t('recordAuthoring',key,parameters));
 const actions=()=>`<div class="dialog-actions"><button class="button" data-action="close-dialog">${text('cancel')}</button></div>`;
 function choose(preferredNotebook){
  const choices=notebooks.directory(state.project,{recursive:true}),id=preferredNotebook??(state.notebook!=='all'?state.notebook:null);
  const notebook=state.book.notebooks.find(n=>n.id===id);
  if(!notebook&&choices.length===1)return choose(choices[0].id);
  const lang=messageLanguage('recordAuthoring');
  if(!notebook){
   showDialog(`<div lang="${lang}"><h2 id="dialog-title">${text('chooseBook')}</h2><div class="record-type-grid">${choices.map(n=>`<button class="record-type-option" data-action="choose-notebook" data-id="${n.id}"><strong>${esc(n.title)}</strong><span>${esc(locationName(state.book,n.projectIds[0]))}</span></button>`).join('')||`<p>${text('createBookFirst')}</p>`}</div><div class="dialog-actions"><button class="button" data-action="close-dialog">${text('cancel')}</button><button class="button primary" data-action="${state.book.projects.length?'new-notebook':'new-project'}">${esc(ux(state.book.projects.length?'createBook':'createProject'))}</button></div></div>`);return;
  }
  if(state.storage?.researchStorage==='catalogue')return selected.open(notebook,{title:t('recordAuthoring','newInBook',{title:notebook.title}),starters:true,onChoose:async choice=>{document.querySelector('#dialog').close();await create(choice.type,choice.notebookId,choice.section??null);}});
  const sections=availableSections(configurationOf(notebook)).filter(s=>!s.profileId||enabledModule(state.dashboardSettings,laboratoryModuleId(s.profileId)));
  const choice=(value,attributes)=>`<button class="record-type-option" ${attributes} aria-label="${text('createType',{type:value.label.toLowerCase()})}"><strong>${esc(value.label)}</strong><span>${esc(value.description)}</span></button>`;
  showDialog(`<div lang="${lang}"><h2 id="dialog-title">${text('newInBook',{title:notebook.title})}</h2><input type="hidden" id="entry-notebook" value="${notebook.id}"><div class="record-type-grid">${sections.map(s=>choice(s,`data-action="choose-template" data-notebook="${notebook.id}" data-id="${s.id}"`)).join('')}</div><details ${sections.length?'':'open'}><summary>${text('generalTypes')}</summary><div class="record-type-grid">${RECORD_TYPES.map(type=>choice(recordTypePresentation(type),`data-action="choose-type" data-type="${type.id}"`)).join('')}</div></details><div class="inline-actions"><button type="button" class="button" data-action="starter-library" data-notebook="${notebook.id}">${esc(t('recordStarters','library'))}</button></div>${actions()}</div>`);
 }
 return {choose,action:selected.action,input:selected.input,stop:selected.stop};
}
