import {recordValueEditor} from './record-value-editor.js';
import {recordValueFields,contributorValueId,relationValueId,mediaValueId,figureValueId} from './record-value-model.js';
import {recordFigureView} from './record-figure-values-ui.js';
import {recordAttemptView} from './record-attempt-values-ui.js';
import {attemptValueField} from './record-attempt-value.js';
import {resultValueId} from './record-result-value.js';
import {recordResultView} from './record-result-values-ui.js';
import {recordMediaView} from './record-media-values-ui.js';
import {recordRelationView} from './record-relations-ui.js';
import {recordDateFields,updateRecordDate} from './record-date-ui.js';
import {recordDateIssue,recordDateLabel} from './record-date.js';
import {templateFieldInput,templateFieldLabel,templateInputValue} from './custom-field-input.js';
import {STATUSES,RECORD_TYPES,recordLabel} from './record-types.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordValues',key,args);
const label=(name,definition)=>resultValueId(name)?text('result'):attemptValueField(name)?t('attempts','title'):contributorValueId(name)?text('contributor'):relationValueId(name)?text('relation'):mediaValueId(name)?text('media'):figureValueId(name)?text('figure'):definition?templateFieldLabel(definition):text(name);
export function recordContributorControls(record,esc,busy=false){
 const button=(name,field)=>'<button type="button" class="button" data-action="record-value-edit" data-value-field="'+esc(field)+'" aria-label="'+esc(name)+'"'+(busy?' disabled':'')+'>'+esc(text('editContributorButton'))+'</button>';
 return '<div class="record-contributor-values">'+(record.contributors.length?'<ul>'+record.contributors.map(person=>'<li data-record-contributor="'+person.id+'"><p>'+esc(person.name)+(person.role?' &middot; '+esc(person.role):'')+'</p>'+button(text('editContributor',{name:person.name}),'contributor:'+person.id)+'</li>').join('')+'</ul>':'<p>'+esc(text('noContributors'))+'</p>')+'<button type="button" class="button" data-action="record-value-add-contributor"'+(busy?' disabled':'')+'>'+esc(text('addContributor'))+'</button></div>';
}
export function recordValueControls(record,esc,selected='title'){
 const option=(name,label)=>'<option value="'+esc(name)+'"'+(name===selected?' selected':'')+'>'+esc(label)+'</option>';
 return '<div class="inline-actions"><label class="field">'+esc(text('choose'))+'<select data-record-detail-field>'+recordValueFields.filter(name=>name!=='type'||!record.template).map(name=>option(name,label(name))).join('')+(record.template?.fields??[]).map(f=>option('template:'+f.key,templateFieldLabel(f))).join('')+'</select></label><button type="button" class="button" data-action="record-value-edit">'+esc(text('edit'))+'</button></div>';
}
export function recordValuesUI(options){
 return recordValueEditor({...options,adapter:{route:'values',baseName:'selection',messages:'recordValues',conflictCodes:['ATTEMPT_CONFLICT'],target:value=>({field:value.field}),view:lifecycle=>recordValuesView(options,lifecycle)}});
}
export function recordValuesView(options,lifecycle){
 const {esc,field}=options,option=(value,name,current)=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(name)+'</option>',helpers={esc,field,option};
 let retainedContributor=null;const media=recordMediaView(options);
 const display=base=>base.field==='type'?recordLabel(base.value.value):base.field==='occurredOn'?recordDateLabel(base.value.value):base.field==='status'?text('status_'+base.value.value):base.value.value===null?text('empty'):typeof base.value.value==='boolean'?text(base.value.value?'yes':'no'):base.value.value;
 const relations=recordRelationView(options,lifecycle),figures=recordFigureView(options,lifecycle),attempts=recordAttemptView(options,lifecycle),results=recordResultView(options,lifecycle);return {
  prepare:(base,value,input)=>attemptValueField(base.field)?attempts.prepare(base,value,input):undefined,
  initialize(base,value,input,changed){if(resultValueId(base.field))results.initialize(base,value,input,changed);else if(attemptValueField(base.field))attempts.initialize(base,value,input,changed);else if(figureValueId(base.field))figures.initialize(base,value,input,changed);},
  rebase(base,value){if(attemptValueField(base.field))attempts.rebase(base,value);},
  bind:dialog=>{relations.bind(dialog);figures.bind(dialog);attempts.bind(dialog);results.bind(dialog);},release:()=>{relations.release();figures.release();attempts.release();results.release();},busy:()=>relations.busy()||figures.busy()||attempts.busy()||results.busy(),
  heading:base=>base?text('heading',{field:label(base.field,base.definition)}):text('edit'),focus:'[data-writing-fields] input,[data-writing-fields] select,[data-writing-fields] textarea',
  fields(base,value,changed){
   const name=base.field,item=value.value;
   if(resultValueId(name))return results.fields(base,value,changed);
   if(attemptValueField(name))return attempts.fields(base,value,changed);
   if(figureValueId(name))return figures.fields(base,value,changed);
   if(mediaValueId(name))return media.fields(base,value);
   if(relationValueId(name))return relations.fields(base,value,changed);
   if(contributorValueId(name)){
    retainedContributor=item??base.definition?.original??{name:'',role:''};
    const removable=!!base.definition?.original,removed=removable&&item===null,disabled=removed?' disabled':'';
    return field(esc(text('contributorName')),'<input data-contributor-value="name" required value="'+esc(retainedContributor.name)+'"'+disabled+'>')+field(esc(text('contributorRole')),'<input data-contributor-value="role" value="'+esc(retainedContributor.role)+'"'+disabled+'>')+(removable?'<label><input type="checkbox" data-contributor-remove'+(removed?' checked':'')+'> '+esc(text('removeContributor'))+'</label><p class="muted">'+esc(text('removeContributorHelp'))+'</p>':'');
   }
   if(name==='occurredOn')return recordDateFields(item,helpers);
   let control;
   if(base.definition)control=templateFieldInput(base.definition,item,{esc,attrs:'data-record-value'});
   else if(name==='type')control='<select data-record-value>'+RECORD_TYPES.map(type=>option(type.id,recordLabel(type.id),item)).join('')+'</select><p class="muted">'+esc(text('typeHelp'))+'</p>';
   else if(name==='status')control='<select data-record-value>'+STATUSES.map(id=>option(id,text('status_'+id),item)).join('')+'</select>';
   else if(name==='share')control='<select data-record-value>'+option('false',text('private'),String(item))+option('true',text('public'),String(item))+'</select>';
   else if(name==='outcome')control='<textarea data-record-value maxlength="500" rows="3">'+esc(item??'')+'</textarea>';
   else control='<input data-record-value required maxlength="180" value="'+esc(item??'')+'">';
   return field(esc(label(name,base.definition)),control);
  },
  preview:base=>resultValueId(base.field)?results.preview(base):attemptValueField(base.field)?attempts.preview(base):figureValueId(base.field)?figures.preview(base):mediaValueId(base.field)?media.preview(base):relationValueId(base.field)?relations.preview(base):contributorValueId(base.field)?'<p>'+esc(base.value.value?base.value.value.name+(base.value.value.role?' · '+base.value.value.role:''):text('contributorAbsent'))+'</p>':'<p>'+esc(display(base))+'</p>',
  input(element,base,value){
   if(resultValueId(base?.field))return results.input(element);
   if(attemptValueField(base?.field))return attempts.input(element);
   if(figureValueId(base?.field))return figures.input(element);
   if(mediaValueId(base?.field))return media.input(element,base,value);
   if(relationValueId(base?.field)){element.setCustomValidity?.('');return relations.input(element,base,value);}
   if(contributorValueId(base?.field)){
    if(element.hasAttribute('data-contributor-remove')){
     if(element.checked){retainedContributor=value.value;value.value=null;}else value.value=structuredClone(retainedContributor);
     for(const control of element.closest('[data-writing-fields]').querySelectorAll('[data-contributor-value]'))control.disabled=element.checked;
     return true;
    }
    if(!element.hasAttribute('data-contributor-value'))return false;
    value.value??={name:'',role:''};value.value[element.dataset.contributorValue]=element.value;return true;
   }
   if(base.field==='occurredOn'){const record={occurredOn:value.value};if(!updateRecordDate(element,record,helpers))return false;value.value=record.occurredOn;return true;}
   if(!element.hasAttribute('data-record-value'))return false;
   value.value=base.definition?templateInputValue(base.definition,element.value):base.field==='share'?element.value==='true':base.field==='outcome'&&!element.value?null:element.value;return true;
  },
  validate(dialog,base,value){if(resultValueId(base.field))return results.validate();if(attemptValueField(base.field))return attempts.validate();if(figureValueId(base.field))return figures.validate();if(relationValueId(base.field))return relations.validate(dialog,base,value);if(base.field!=='occurredOn')return true;const issue=recordDateIssue(value.value);if(issue){dialog.querySelector('[data-record-date-error]').textContent=issue;return false;}return true;}
 };
}
