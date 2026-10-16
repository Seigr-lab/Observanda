import {bookText as text} from './web/book-messages.js';
import {readingJourney} from './web/book-journeys.js';
import {dateBounds,recordDateLabel} from './web/record-date.js';
export function browseRows(records,esc){
 return '<ol class="book-record-index" data-book-records>'+records.map(r=>{
  const bounds=dateBounds(r.occurredOn);
  return `<li data-public-record="${r.id}" data-journey="${readingJourney(r)}" data-type="${esc(r.type)}" data-tags="${esc(JSON.stringify(r.tags))}" data-start="${bounds?.from??''}" data-end="${bounds?.to??''}"><a href="entries/${r.id}.html">${esc(r.title)}</a><p>${esc(text(readingJourney(r)))} · ${esc(recordDateLabel(r.occurredOn))}</p>${r.tags.length?'<p>'+r.tags.map(esc).join(' · ')+'</p>':''}</li>`;
 }).join('')+'</ol>';
}
