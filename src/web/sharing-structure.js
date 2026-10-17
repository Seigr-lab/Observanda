import {t} from './i18n/index.js';
const tr=key=>t('sharing',key);

export function sharingStructure(structure,esc){
 if(!structure||!structure.title&&!structure.books.length)return '';
 const book=(value,version)=>{
  if(!value)return '<p>'+esc(tr('absentBook'))+'</p>';
  return '<h4>'+esc(value.title)+'</h4>'+(value.configuration?'<div data-sharing-configuration data-notebook-id="'+esc(value.id)+'" data-version="'+version+'"><button type="button" class="button" data-sharing-config-action="open">'+esc(tr('configurationInspect'))+'</button></div>':'<p>'+esc(t('configurationEditor','empty'))+'</p>');
 };
 return '<section class="sharing-structure"><h3>'+esc(tr('structureChanges'))+'</h3><p>'+esc(tr('structureHelp'))+'</p>'+(structure.title?'<p>'+esc(structure.title.before)+' \u2192 '+esc(structure.title.after)+'</p>':'')+structure.books.map(row=>'<details><summary>'+esc(row.after?.title??row.before.title)+'</summary><h4>'+esc(tr('base'))+'</h4>'+book(row.before,'base')+'<h4>'+esc(tr('incomingVersion'))+'</h4>'+book(row.after,'incoming')+'</details>').join('')+'</section>';
}
