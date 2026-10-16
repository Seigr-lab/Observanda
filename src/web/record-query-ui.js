import {recordBrowse,browseActive} from './record-query.js';
import {profileById} from './laboratory/catalog.js';
import {STATUSES} from './record-types.js';
import {BOOK_JOURNEYS} from './book-journeys.js';
import {t} from './i18n/index.js';

export function recordDomainChoices(ids,current='all'){
 const domains=[...new Set(ids.filter(Boolean))];if(current!=='all'&&current!=='general'&&!domains.includes(current))domains.push(current);
 return [{value:'all',label:'All lab types'},{value:'general',label:'General / custom'},...domains.map(id=>({value:id,label:profileById(id)?.label??id}))];
}
export function recordBrowseFields(state,records,{esc,field,option,domains:knownDomains=null}) {
 const b=recordBrowse(state.recordBrowse);
 const domains=knownDomains??records.map(e=>e.template?.profileId);

 return `<details class="record-browse" ${browseActive(b)?'open':''}><summary id="record-filter-summary">Filters${browseActive(b)?' ('+browseActive(b)+')':''}</summary>
  <div class="record-browse-fields">
  ${field(esc(t('book','journey')),`<select data-record-browse="journey">${BOOK_JOURNEYS.map(j=>option(j,t('book',j),b.journey??'all')).join('')}</select>`)}
  ${field('Tags',`<input data-record-browse="tags" maxlength="512" value="${esc(b.tags)}" placeholder="Separate tags with commas" aria-describedby="record-tags-help">`)}
  ${field('Match tags',`<select data-record-browse="tagMode">${option('all','All of these tags',b.tagMode)}${option('any','Any of these tags',b.tagMode)}</select>`)}
  ${field('From date',`<input type="date" data-record-browse="from" value="${esc(b.from)}">`)}
  ${field('Through date',`<input type="date" data-record-browse="to" value="${esc(b.to)}">`)}
  ${field('Date certainty',`<select data-record-browse="dateKnowledge">${[['all','All dates'],['known','Known dates'],['estimated','Estimated dates'],['unknown','Unknown dates']].map(([id,label])=>option(id,label,b.dateKnowledge)).join('')}</select>`)}
  ${field('Lab type',`<select data-record-browse="domain">${recordDomainChoices(domains,b.domain).map(c=>option(c.value,c.label,b.domain)).join('')}</select>`)}
  ${field('Progress',`<select data-record-browse="status">${option('all','All progress states',b.status)}${STATUSES.map(v=>option(v,v.charAt(0).toUpperCase()+v.slice(1),b.status)).join('')}</select>`)}
  ${field('Sort records',`<select data-record-browse="sort">${[['date-desc','Newest date first'],['date-asc','Oldest date first'],['title','Title']].map(([id,label])=>option(id,label,b.sort)).join('')}</select>`)}
  <div class="inline-actions"><button type="button" class="button" data-action="clear-record-filters">Clear filters</button></div></div>
  <p id="record-tags-help" class="muted">Tags match whole names. Date ranges include overlapping months, years and ranges; unknown dates are excluded. Estimates use their declared date, with no assumed margin. Unknown dates sort last. Lab type comes from the record's template.</p>
 </details>`;
}
