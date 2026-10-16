import {t} from './i18n/index.js';
import {customFieldLabel} from './custom-field-presentation.js';
const tr=key=>t('sharing',key);

export function sharingStructure(structure,esc){
 if(!structure||!structure.title&&!structure.books.length)return '';
 const book=value=>value?'<h4>'+esc(value.title)+'</h4>'+((value.configuration?.sections??[]).map(section=>'<section><strong>'+esc(section.label)+'</strong> · '+esc(tr(section.enabled?'typeEnabled':'typeDisabled'))+(section.description?'<p>'+esc(section.description)+'</p>':'')+'<ul>'+section.fields.map(field=>'<li>'+esc(customFieldLabel(field))+' · '+esc(field.type)+(field.required?' · '+esc(tr('required')):'')+(field.choices?.length?': '+field.choices.map(v=>esc(v)).join(', '):'')+'</li>').join('')+'</ul></section>').join('')):'<p>'+esc(tr('absentBook'))+'</p>';
 return '<section class="sharing-structure"><h3>'+esc(tr('structureChanges'))+'</h3><p>'+esc(tr('structureHelp'))+'</p>'+(structure.title?'<p>'+esc(structure.title.before)+' → '+esc(structure.title.after)+'</p>':'')+structure.books.map(row=>'<details><summary>'+esc(row.after?.title??row.before.title)+'</summary><h4>'+esc(tr('base'))+'</h4>'+book(row.before)+'<h4>'+esc(tr('incomingVersion'))+'</h4>'+book(row.after)+'</details>').join('')+'</section>';
}
