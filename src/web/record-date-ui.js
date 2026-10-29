import {dateParts,recordDateIssue} from './record-date.js';
import {t} from './i18n/index.js';
import './i18n/catalogues/recordEditors.js';
const text=key=>t('recordDates',key);
const issue=value=>recordDateIssue(value,{translate:t});

export function recordDateFields(value,{field,option,esc}){
 const d=dateParts(value),kind=d.kind;
 return `<fieldset class="record-date-fields"><legend>${esc(text('fieldDate'))}</legend>
 ${field(text('fieldPrecision'),`<select data-record-date="kind">${[['day','precisionDay'],['month','precisionMonth'],['year','precisionYear'],['range','precisionRange'],['unknown','precisionUnknown']].map(([id,key])=>option(id,text(key),kind)).join('')}</select>`)}
 <div data-record-date-values>${recordDateValues(value,{field,esc})}</div>
 <p class="muted" id="record-date-help">${esc(text('fieldHelp'))}</p>
 <p data-record-date-error role="status">${esc(issue(value))}</p></fieldset>`;
}
function recordDateValues(value,{field,esc}){
 const d=dateParts(value);
 if(d.kind==='unknown')return '<p class="muted">'+esc(text('noDate'))+'</p>';
 const input=(label,key,type,value)=>field(label,`<input type="${type}" data-record-date="${key}" ${key==='value'&&d.kind==='day'?'data-entry="occurredOn"':''} value="${esc(value)}" ${type==='text'?'inputmode="numeric" maxlength="4" placeholder="YYYY"':''} aria-describedby="record-date-help">`);
 return (d.kind==='range'
  ?input(text('fieldStart'),'from','date',d.from)+input(text('fieldEnd'),'to','date',d.to)
  :input(text(d.kind==='day'?'fieldDate':d.kind==='month'?'fieldMonth':'fieldYear'),'value',d.kind==='day'?'date':d.kind==='month'?'month':'text',d.value))+
  `<label class="checkbox"><input type="checkbox" data-record-date="estimated" ${d.estimated?'checked':''}><span>${esc(text(d.kind==='range'?'estimatedRange':'estimatedDate'))}</span></label>`;
}
export function updateRecordDate(el,record,helpers){
 const key=el.dataset.recordDate;if(!key||!record)return false;
 let d={...dateParts(record.occurredOn)};
 if(key==='kind'){
  const kind=el.value,old=d.kind,value=d.value??'';
  // Keep only precision already declared. Never fill a missing month/day or use today.
  const shortened=kind==='year'&&['day','month','year'].includes(old)?value.slice(0,4)
   :kind==='month'&&['day','month'].includes(old)?value.slice(0,7):kind==='day'&&old==='day'?value:'';
  d=kind==='unknown'?{kind}:kind==='range'?{kind,from:old==='day'?value:'',to:'',estimated:d.estimated??false}:{kind,value:shortened,estimated:d.estimated??false};
 }else d[key]=key==='estimated'?el.checked:el.value;
 record.occurredOn=d.kind==='day'&&!d.estimated?d.value:d;
 const group=el.closest('.record-date-fields');
 if(key==='kind')group.querySelector('[data-record-date-values]').innerHTML=recordDateValues(record.occurredOn,helpers);
 group.querySelector('[data-record-date-error]').textContent=issue(record.occurredOn);
 return true;
}
