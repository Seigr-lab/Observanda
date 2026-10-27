import {recordValueFields,contributorValueId,relationValueId,mediaValueId,figureValueId} from './record-value-model.js';
import {attemptValueField} from './record-attempt-value.js';
import {resultValueId} from './record-result-value.js';
import {customFieldLabel as templateFieldLabel} from './custom-field-presentation.js';
import {attemptView} from './attempt-view.js';
import {emptyAttempt} from './attempt-model.js';
import {resultStatementsView} from './result-statements.js';
import {analysisText as a} from './analysis-messages.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordValues',key,args);
const attemptText=(key,args)=>t('attempts',key,args);
// Read controls do not load the editors, importers or recoverable draft engines.
export const recordValueLabel=(name,definition)=>resultValueId(name)?text('result'):attemptValueField(name)?t('attempts','title'):contributorValueId(name)?text('contributor'):relationValueId(name)?text('relation'):mediaValueId(name)?text('media'):figureValueId(name)?text('figure'):definition?templateFieldLabel(definition):text(name);
export function recordContributorControls(record,esc,busy=false){
 const button=(name,field)=>'<button type="button" class="button" data-action="record-value-edit" data-value-field="'+esc(field)+'" aria-label="'+esc(name)+'"'+(busy?' disabled':'')+'>'+esc(text('editContributorButton'))+'</button>';
 return '<div class="record-contributor-values">'+(record.contributors.length?'<ul>'+record.contributors.map(person=>'<li data-record-contributor="'+person.id+'"><p>'+esc(person.name)+(person.role?' &middot; '+esc(person.role):'')+'</p>'+button(text('editContributor',{name:person.name}),'contributor:'+person.id)+'</li>').join('')+'</ul>':'<p>'+esc(text('noContributors'))+'</p>')+'<button type="button" class="button" data-action="record-value-add-contributor"'+(busy?' disabled':'')+'>'+esc(text('addContributor'))+'</button></div>';
}
export function recordValueControls(record,esc,selected='title'){
 const option=(name,label)=>'<option value="'+esc(name)+'"'+(name===selected?' selected':'')+'>'+esc(label)+'</option>';
 return '<div class="inline-actions"><label class="field">'+esc(text('choose'))+'<select data-record-detail-field>'+recordValueFields.filter(name=>name!=='type'||!record.template).map(name=>option(name,recordValueLabel(name))).join('')+(record.template?.fields??[]).map(f=>option('template:'+f.key,templateFieldLabel(f))).join('')+'</select></label><button type="button" class="button" data-action="record-value-edit">'+esc(text('edit'))+'</button></div>';
}
export const recordFigureAction=(figure,esc,busy=false)=>'<button type="button" class="button record-figure-edit" data-action="record-value-edit" data-value-field="figure:'+figure.id+'" aria-label="'+esc(text('editFigure',{title:typeof figure.title==='string'?figure.title:figure.title.preview}))+'"'+(busy?' disabled':'')+'>'+esc(text('editFigureButton'))+'</button>';
const action=(esc,kind,label,prior='')=>'<button type="button" class="button" data-action="record-value-add-attempt" data-kind="'+kind+'" data-prior="'+prior+'">'+esc(label)+'</button>';
export function recordAttemptControls(record,esc,reference,{window=null,navigation}={}){
 const attempt=record.attempt??emptyAttempt();
 return '<section class="record-attempt-values"><div class="inline-actions">'+action(esc,'preparation',attemptText(attempt.preparations.length?'amendPreparation':'addPreparation'))+action(esc,'event',attemptText('addEvent'))+((window?window.hasCriteria:attempt.preparations.some(p=>p.criteria.length))?action(esc,'assessment',attemptText('addAssessment')):'')+'</div>'+attemptView(record.attempt,esc,{reference,window,navigation,correct:(kind,item)=>action(esc,kind,attemptText('correct'),item.id)})+'</section>';
}

export function recordResultControls(record,esc,reference){
 return '<div class="record-result-values"><button type="button" class="button" data-action="record-value-add-result">'+esc(a('addResult'))+'</button>'+resultStatementsView(record.results,esc,{reference,edit:s=>'<button type="button" class="button" data-action="record-value-edit" data-value-field="result:'+s.id+'">'+esc(a('editResult'))+'</button>'})+'</div>';
}
