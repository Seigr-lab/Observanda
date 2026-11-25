import {t} from './i18n/index.js';
// The location breadcrumb for pages below another page (as Inspect external logbook is
// below Workspaces): links to each level, then the current page by name. Places inside
// projects use the project directory's trail, which follows the live project tree.
export function breadcrumb(esc,levels,current){
 return '<nav class="location-trail breadcrumb" aria-label="'+esc(t('projectDirectory','location'))+'"><ol>'+
  levels.map(level=>'<li><button type="button" class="text-button" data-action="'+esc(level.action)+'">'+esc(level.label)+'</button></li>').join('')+
  '<li aria-current="page">'+esc(current)+'</li></ol></nav>';
}
