import {t} from './i18n/index.js';
import messages from './locales/en/recordEditors.json' with {type:'json'};
import {modelMessages} from './model-messages.js';
const tr=(key,values)=>t('recordDates',key,values);
// A declared record date is independent of creation, editing and acquisition clocks.
// Exact saved days keep their original string representation and revision identity.
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key));
export const calendarDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const month=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const year=value=>typeof value==='string'&&/^\d{4}$/.test(value);
const draftText=value=>typeof value==='string'&&value.length<=10&&!/[\u0000-\u001f]/.test(value);
export const dateParts=value=>typeof value==='string'?{kind:'day',value,estimated:false}:value;
export function validRecordDate(value,{draft=false}={}){
 if(typeof value==='string')return draft?draftText(value):calendarDate(value);
 if(keys(value,['kind'])&&value.kind==='unknown')return true;
 if(!value||typeof value.estimated!=='boolean')return false;
 if(value.kind==='range')return keys(value,['kind','from','to','estimated'])&&(draft
  ?draftText(value.from)&&draftText(value.to)
  :calendarDate(value.from)&&calendarDate(value.to)&&value.from<=value.to);
 return keys(value,['kind','value','estimated'])&&['day','month','year'].includes(value.kind)&&(draft?draftText(value.value):{day:calendarDate,month,year}[value.kind](value.value));
}
export function recordDateIssue(value,{translate}={}){
 if(validRecordDate(value))return '';
 const message=modelMessages('recordEditors',messages,translate);
 if(value?.kind==='range'&&calendarDate(value.from)&&calendarDate(value.to)&&value.from>value.to)return message('dateOrder');
 return message({month:'dateInvalidMonth',year:'dateInvalidYear',range:'dateInvalidRange'}[value?.kind]??'dateInvalidDay');
}
export function dateBounds(value){
 if(!validRecordDate(value))return null;
 const d=dateParts(value);
 if(d.kind==='unknown')return null;
 if(d.kind==='range')return {from:d.from,to:d.to};
 if(d.kind==='day')return {from:d.value,to:d.value};
 if(d.kind==='year')return {from:d.value+'-01-01',to:d.value+'-12-31'};
 const [y,m]=d.value.split('-').map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
 return {from:d.value+'-01',to:d.value+'-'+days};
}
// Bounds are for ordering/filter overlap only, never stored or presented as exact dates.
// An estimated day has no invented uncertainty margin; users can declare a range.
export function dateInRange(value,from='',to=''){
 if(!from&&!to)return true;
 const bounds=dateBounds(value);
 return !!bounds&&(!from||bounds.to>=from)&&(!to||bounds.from<=to);
}
export const dateKnowledge=value=>dateParts(value)?.kind==='unknown'?'unknown':dateParts(value)?.estimated?'estimated':'known';
export function compareRecordDates(a,b,{descending=false}={}){
 const x=dateBounds(a.occurredOn),y=dateBounds(b.occurredOn);
 if(!x||!y)return x?-1:y?1:0; // Unknown stays last in both directions.
 const order=x.from.localeCompare(y.from)||x.to.localeCompare(y.to);
 return descending?-order:order;
}
export function recordDateLabel(value){
 if(!validRecordDate(value))return tr('unset');
 const d=dateParts(value);
 if(d.kind==='unknown')return tr('unknown');
 const label=d.kind==='range'?tr('range',{from:d.from,to:d.to}):d.kind==='month'
  ?tr('month',{month:tr('month'+Number(d.value.slice(5))),year:d.value.slice(0,4)})
  :d.kind==='year'?tr('year',{year:d.value}):d.value;
 return d.estimated?tr('estimated',{date:label}):label;
}
export function recordDateHTML(value,esc){
 const label=esc(recordDateLabel(value));
 return typeof value==='string'&&calendarDate(value)?'<time datetime="'+esc(value)+'">'+label+'</time>':'<span class="record-date">'+label+'</span>';
}
