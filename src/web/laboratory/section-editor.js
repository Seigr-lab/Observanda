import {fieldNumberControls} from '../custom-field-number-controls.js';
import {setCustomFieldProperty} from '../custom-field-numbers.js';
import {customFieldText as tr} from '../custom-field-presentation.js';
const fieldTypes=['text','number','date','boolean','select'];

// The schema controls are shared by Preferences and the lab book editor.
export function sectionDetails(s,i,c){
 const {field,esc,option,button}=c,attr=`data-lab-section="${i}"`;
 return `<div class="lab-schema-details">
  ${field(tr('typeName'),`<textarea ${attr} data-lab-section-prop="label" rows="1" required maxlength="160">${esc(s.label)}</textarea>`)}
  ${field(tr('guidance'),`<textarea ${attr} data-lab-section-prop="description" rows="2" maxlength="2000">${esc(s.description)}</textarea>`)}
  <div class="lab-fields-heading"><div><h4>${esc(tr('fields'))}</h4><p>${esc(tr('savedFields'))}</p></div>${button(tr('addField'),'field-add',`data-index="${i}"`)}</div>
  <div class="lab-schema-fields">${s.fields.map((f,j)=>`<div class="lab-field-config" data-field-key="${esc(f.key)}">
   <div class="lab-field-primary">
    ${field(tr('label'),`<textarea ${attr} data-lab-field="${j}" data-lab-field-prop="label" rows="1" required maxlength="160">${esc(f.label)}</textarea>`)}
    ${field(tr('type'),`<select ${attr} data-lab-field="${j}" data-lab-field-prop="type">${fieldTypes.map(id=>option(id,tr('types.'+id),f.type)).join('')}</select>`)}
    ${f.type==='number'?field(tr('unit'),`<input ${attr} data-lab-field="${j}" data-lab-field-prop="unit" maxlength="80" value="${esc(f.unit)}">`):''}
    <div class="lab-field-actions"><label class="checkbox"><input type="checkbox" ${attr} data-lab-field="${j}" data-lab-field-prop="required" ${f.required?'checked':''}>${esc(tr('required'))}</label>${button(tr('remove'),'field-remove',`data-index="${i}" data-field="${j}" aria-label="${esc(tr('removeField',{label:f.label}))}"`,'subtle')}</div>
   </div>
   ${fieldNumberControls(f,c,key=>`${attr} data-lab-field="${j}" data-lab-field-prop="${key}"`)}
   ${f.type==='select'?field(tr('choices'),`<textarea ${attr} data-lab-field="${j}" data-lab-field-prop="choices" rows="2">${esc(f.choices.join('\n'))}</textarea>`):''}
  </div>`).join('')||'<p class="muted">'+esc(tr('empty'))+'</p>'}</div>
 </div>`;
}
// Both Preferences and the lab book editor mutate the same section schema.
export function sectionInput(el,lab){
 const a=el.dataset;if(a.labSection===undefined)return false;
 const s=lab.sections[Number(a.labSection)];if(!s)return false;
 if(a.labField!==undefined){
  const f=s.fields[Number(a.labField)],key=a.labFieldProp;
  return setCustomFieldProperty(f,key,key==='required'?el.checked:key==='choices'?el.value.split('\n').map(v=>v.trim()).filter(Boolean):el.value);
 }else if(['label','description','enabled'].includes(a.labSectionProp))s[a.labSectionProp]=a.labSectionProp==='enabled'?el.checked:el.value;
 else return false;
 return true;
}
export function sectionAction(lab,name,a,profileId=null){
 // Record actions share the dispatcher but have no section configuration.
 if(!Array.isArray(lab?.sections))return false;
 if(name==='section-add'){
  const s={id:crypto.randomUUID(),profileId,key:'section-'+crypto.randomUUID(),label:tr('newType'),description:'',enabled:true,fields:[]};
  lab.sections.push(s);return {added:s.id};
 }
 const i=Number(a.index),section=lab.sections[i];if(!section)return false;
 if(name==='section-remove'||name==='section-restore'){section.enabled=name==='section-restore';return true;}
 if(name==='section-move'){
  const siblings=lab.sections.map((s,index)=>({s,index})).filter(({s})=>s.profileId===section.profileId&&s.enabled);
  const from=siblings.findIndex(item=>item.index===i),to=from+Number(a.direction);
  if(to>=0&&to<siblings.length){const target=siblings[to].index;[lab.sections[i],lab.sections[target]]=[lab.sections[target],lab.sections[i]];}return true;
 }
 if(name==='field-add'){section.fields.push({key:'field_'+crypto.randomUUID().replaceAll('-',''),label:tr('newField'),type:'text',unit:'',required:false,choices:[]});return true;}
 if(name==='field-remove'){section.fields.splice(Number(a.field),1);return true;}
 return false;
}
