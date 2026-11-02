import en from './web/locales/en/recordDates.json' with {type:'json'};
import ca from './web/locales/ca/recordDates.json' with {type:'json'};
import es from './web/locales/es/recordDates.json' with {type:'json'};
import nb from './web/locales/nb/recordDates.json' with {type:'json'};
import nn from './web/locales/nn/recordDates.json' with {type:'json'};
import {calendarDate,dateBounds} from './web/record-date.js';
import {RECORD_TYPES,STATUSES} from './web/record-types.js';
import {attr,descendants} from './website-migration-views.js';

const locales=[en,ca,es,nb,nn];
export const fold=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const invisible=node=>['script','style','template','noscript','svg','textarea','nav','button'].includes(node.tagName)||node.attrs?.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true');
const field=node=>attr(node,'data-observanda-part');
const label=node=>node&&!invisible(node)&&node.childNodes?.every(c=>c.nodeName==='#text')?node.childNodes.map(c=>c.value).join('').trim():null;
const types=new Set(RECORD_TYPES.map(t=>t.id));
const pattern=(template,values)=>new RegExp('^'+template.split(/(\{\w+\})/u).map(part=>values[part]??part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$','iu');
const parsing=locales.map(locale=>({
 unknown:locale.unknown,estimate:pattern(locale.estimated,{'{date}':'(?<value>.+)'}),
 range:pattern(locale.range,{'{from}':'(?<from>\\d{4}-\\d{2}-\\d{2})','{to}':'(?<to>\\d{4}-\\d{2}-\\d{2})'}),
 month:pattern(locale.month,{'{month}':'(?<month>.+?)','{year}':'(?<year>\\d{4})'}),
 months:Array.from({length:12},(_,i)=>locale['month'+(i+1)].toLowerCase()),
 year:pattern(locale.year,{'{year}':'(?<year>\\d{4})'})
}));
function projectedDate(label){
 for(const language of parsing){
  if(label===language.unknown)return {kind:'unknown'};
  const estimate=language.estimate.exec(label),value=estimate?.groups.value??label,estimated=Boolean(estimate);
  if(calendarDate(value))return {kind:'day',value,estimated};
  const range=language.range.exec(value)?.groups;
  if(range&&calendarDate(range.from)&&calendarDate(range.to)&&range.from<=range.to)return {kind:'range',...range,estimated};
  const month=language.month.exec(value)?.groups;
  if(month){const index=language.months.indexOf(month.month.toLowerCase());if(index>=0)return {kind:'month',value:month.year+'-'+String(index+1).padStart(2,'0'),estimated};}
  const year=language.year.exec(value)?.groups.year;if(year)return {kind:'year',value:year,estimated};
 }
 return null;
}

// Derive each field from its own visible, saved publication part. A tag
// spelled inside the body or a nested section never becomes an entry tag.
export function websiteSearchFields(fragment){
 const result={searchVersion:1,recordType:null,status:null,tags:[],displayDate:null,dateFrom:null,dateTo:null,dateKnowledge:null};
 let metadata=false,tags=false;
 for(const node of descendants(fragment)){
  const key=field(node);if(key!=='tags'&&key!=='metadata'||key==='metadata'&&metadata||key==='tags'&&tags)continue;
  let skip=false;for(let parent=node;parent;parent=parent.parentNode)if(invisible(parent)||parent!==node&&field(parent)){skip=true;break;}if(skip)continue;
  const children=node.childNodes?.filter(c=>c.tagName&&!invisible(c))??[];
  if(key==='tags'){
   if(node.tagName!=='ul')continue;
   result.tags=[...new Set(children.filter(c=>c.tagName==='li'&&c.childNodes.every(n=>n.nodeName==='#text')).map(c=>c.childNodes.map(n=>n.value).join('')).filter(v=>v.trim()&&v.length<=40))];tags=true;
  }else{
   metadata=true;
   const first=children[0],last=children.at(-1),type=label(first),status=label(last);
   if(first?.tagName==='span'&&types.has(type))result.recordType=type;
   if(last!==first&&last?.tagName==='span'&&STATUSES.includes(status))result.status=status;
   const date=children.find(n=>n.tagName==='time'||n.tagName==='span'&&attr(n,'class')==='record-date');
   const visible=label(date);if(visible&&visible.length<=100){
    const datetime=date.tagName==='time'?attr(date,'datetime'):null;
    const machineDate=typeof datetime==='string'&&calendarDate(datetime)?datetime:null;
    result.displayDate=machineDate??visible;
    const declared=machineDate?{kind:'day',value:machineDate,estimated:false}:projectedDate(visible);
    const bounds=declared&&dateBounds(declared);
    if(bounds){result.dateFrom=bounds.from;result.dateTo=bounds.to;}
    if(declared)result.dateKnowledge=declared.kind==='unknown'?'unknown':declared.estimated?'estimated':'known';
   }
  }
  if(metadata&&tags)break;
 }
 return result;
}
