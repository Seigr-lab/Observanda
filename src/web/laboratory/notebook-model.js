import {isConfigurationReference} from '../configuration-reference.js';
import {t} from '../i18n/index.js';

import {labBookProfileLabel} from '../project-type-presentation.js';
import {configurationOf} from '../notebook-schema.js';
import {notebooksIn} from '../workspace-structure.js';
export const notebookRoute=id=>({action:'filter-notebook',id});
export const notebookTypes=n=>isConfigurationReference(n?.configuration)?[t('configurationEditor','profilesLoading')]:configurationOf(n).profiles.filter(p=>p.enabled).map(p=>labBookProfileLabel(p.id));
export function notebookDirectory(book,projectId=null,options){
 return notebooksIn(book,projectId,options).map(n=>({id:n.id,title:n.title,kind:'notebook',projectIds:[n.projectId],types:options?.types?options.types(n):notebookTypes(n),count:options?.counts?.[n.id]??(n.dedicated?null:book.entries.filter(e=>e.notebookId===n.id).length),route:notebookRoute(n.id)}));
}
