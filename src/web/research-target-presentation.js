import {researchTargets as modelTargets} from './record-model.js';
import {locationName} from './workspace-structure.js';
import {projectKindLabel} from './project-type-presentation.js';
import {t} from './i18n/index.js';

// Search and picker context labels belong to the interface. References and
// authored names retain their original values in the shared record model.
export function researchTargets(book){
 const projects=new Map(book.projects.map(item=>[item.id,item])),notebooks=new Map(book.notebooks.map(item=>[item.id,item])),entries=new Map(book.entries.map(item=>[item.id,item]));
 return modelTargets(book).map(item=>{
  const context=item.kind==='workspace'?t('researchPicker','workspace')
   :item.kind==='project'?projectKindLabel(projects.get(item.id)?.kind)+' · '+locationName(book,item.id)
   :item.kind==='notebook'?t('projectEditors','labBook')+' · '+locationName(book,notebooks.get(item.id)?.projectId)
   :t('researchPicker','record')+' · '+(notebooks.get(entries.get(item.id)?.notebookId)?.title??'');
  return {...item,context};
 });
}
