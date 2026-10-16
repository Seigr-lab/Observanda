import {projectDirectoryChoices} from './project-directory-choices.js';
import {t} from './i18n/index.js';
// Select the catalogue that will own the website before creating its draft.
export function websiteProjectPicker({state,api,esc,book}){
 let selected=null,initial=[];
 const host=()=>document.querySelector('#website-site-form');
 const choices=projectDirectoryChoices({state,api,esc,changed:paint});
 function rows(){const values=choices.rows('record-parents',initial),picked=choices.known(selected)??initial.find(row=>row.projectId===selected);return picked&&!values.some(row=>row.projectId===selected)?[picked,...values]:values;}
 function paint(){const form=host(),select=form?.querySelector('[name=projectId]');if(!select)return;select.innerHTML='<option value="">'+esc(t('websiteSites','chooseProject'))+'</option>'+rows().map(row=>'<option value="'+esc(row.projectId)+'">'+esc([...(row.ancestors??[]),row.summary.title].join(' / '))+'</option>').join('');select.value=selected??'';choices.paint(form,'record-parents');}
 return {
  start(projectId){initial=book().projects.map(row=>({projectId:row.id,summary:{title:row.title},legacy:!state.projectOwner}));selected=projectId??state.projectOwner?.projectId??initial[0]?.projectId??null;if(!state.projectOwner?.labBookId)choices.start(null,{recordParents:true,templates:false});else choices.reset();const search=host()?.querySelector('[data-project-choice-search]');if(search)search.value='';paint();},
  view:()=>state.projectOwner?.labBookId?'':choices.view('record-parents'),
  input(element){if(!element.closest('#website-site-form'))return false;if(element.name==='projectId'){selected=element.value;return true;}return choices.input(element);},
  action:element=>element.closest('#website-site-form')?choices.action(element):false,
  destination(id){const row=choices.known(id)??initial.find(row=>row.projectId===id);if(!row)throw {code:'NOT_FOUND',message:t('websiteSites','chooseProject')};return state.projectOwner?.labBookId?{projectId:id,labBookId:state.projectOwner.labBookId}:row.legacy?null:id;},
  clear(){choices.reset();initial=[];selected=null;}
 };
}
