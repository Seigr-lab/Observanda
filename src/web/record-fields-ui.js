import {templateFieldInput,templateFieldLabel,templateInputValue} from './custom-field-input.js';
export function recordFields(entry,{field,esc}){
 const t=entry.template;if(!t)return '';
 return `<section class="record-template"><h3>${esc(t.label)}</h3>${t.description?'<p class="muted">'+esc(t.description)+'</p>':''}<div class="form-grid">${t.fields.map(f=>{
  return field(esc(templateFieldLabel(f)),templateFieldInput(f,t.values[f.key],{esc,attrs:`data-record-field="${esc(f.key)}"`}));
 }).join('')}</div></section>`;
}
export function updateRecordField(el,entry){
 const key=el.dataset.recordField;if(!key||!entry?.template)return false;
 const field=entry.template.fields.find(f=>f.key===key);if(!field)return false;
 entry.template.values[key]=templateInputValue(field,el.value);return true;
}
