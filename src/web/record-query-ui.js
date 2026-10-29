import {recordBrowse,browseActive} from './record-query.js';
import {labBookProfileLabel} from './project-type-presentation.js';
import './i18n/catalogues/applicationTexts.js';
import {STATUSES} from './record-types.js';
import {BOOK_JOURNEYS} from './book-journeys.js';
import {t} from './i18n/index.js';
const tr=(key,args)=>t('applicationTexts',key,args);

export function recordDomainChoices(ids,current='all'){
 const domains=[...new Set(ids.filter(Boolean))];if(current!=='all'&&current!=='general'&&!domains.includes(current))domains.push(current);
 return [{value:'all',label:tr('browseAllLabTypes')},{value:'general',label:tr('browseGeneral')},...domains.map(id=>({value:id,label:labBookProfileLabel(id)}))];
}
export function recordBrowseFields(state,records,{esc,field,option,domains:knownDomains=null}) {
 const b=recordBrowse(state.recordBrowse);
 const domains=knownDomains??records.map(e=>e.template?.profileId);

 return `<details class="record-browse" ${browseActive(b)?'open':''}><summary id="record-filter-summary">${esc(tr('filters'))}${browseActive(b)?' ('+browseActive(b)+')':''}</summary>
  <div class="record-browse-fields">
  ${field(esc(t('book','journey')),`<select data-record-browse="journey">${BOOK_JOURNEYS.map(j=>option(j,t('book',j),b.journey??'all')).join('')}</select>`)}
  ${field(esc(tr('tags')),`<input data-record-browse="tags" maxlength="512" value="${esc(b.tags)}" placeholder="${esc(tr('browseTagsPlaceholder'))}" aria-describedby="record-tags-help">`)}
  ${field(esc(tr('browseMatchTags')),`<select data-record-browse="tagMode">${option('all',tr('browseAllTags'),b.tagMode)}${option('any',tr('browseAnyTags'),b.tagMode)}</select>`)}
  ${field(esc(tr('browseFrom')),`<input type="date" data-record-browse="from" value="${esc(b.from)}">`)}
  ${field(esc(tr('browseThrough')),`<input type="date" data-record-browse="to" value="${esc(b.to)}">`)}
  ${field(esc(tr('browseDateCertainty')),`<select data-record-browse="dateKnowledge">${[['all',tr('browseAllDates')],['known',tr('browseKnownDates')],['estimated',tr('browseEstimatedDates')],['unknown',tr('browseUnknownDates')]].map(([id,label])=>option(id,label,b.dateKnowledge)).join('')}</select>`)}
  ${field(esc(tr('browseLabType')),`<select data-record-browse="domain">${recordDomainChoices(domains,b.domain).map(c=>option(c.value,c.label,b.domain)).join('')}</select>`)}
  ${field(esc(tr('progress')),`<select data-record-browse="status">${option('all',tr('browseAllProgress'),b.status)}${STATUSES.map(v=>option(v,t('recordValues','status_'+v),b.status)).join('')}</select>`)}
  ${field(esc(tr('browseSort')),`<select data-record-browse="sort">${[['date-desc',tr('browseNewest')],['date-asc',tr('browseOldest')],['title',tr('browseTitle')]].map(([id,label])=>option(id,label,b.sort)).join('')}</select>`)}
  <div class="inline-actions"><button type="button" class="button" data-action="clear-record-filters">${esc(t('recordLists','clear'))}</button></div></div>
  <p id="record-tags-help" class="muted">${esc(tr('browseHelp'))}</p>
 </details>`;
}
