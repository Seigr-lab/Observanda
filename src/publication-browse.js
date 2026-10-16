import {bookText as text} from './web/book-messages.js';
import {BOOK_JOURNEYS} from './web/book-journeys.js';
import {browseRows} from './publication-browse-rows.js';
import {matchesPublicRecord} from './web/public-browse-query.js';
import {enhancePublicBook} from './web/public-book.js';
import {enhancePublicIndex} from './web/public-index.js';
export const PUBLIC_BOOK_SCRIPT='('+enhancePublicBook.toString()+')(document,location,history,sessionStorage,window,'+matchesPublicRecord.toString()+','+enhancePublicIndex.toString()+');\n';
export function publicationBrowse(records,esc,{page=null}={}){
 if(page)return pagedBrowse(records,esc,page);
 const choices=(values,label)=>'<option value="">'+esc(text('all'))+'</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(label(v))+'</option>').join('');
 const field=(key,html)=>'<label>'+esc(text(key))+html+'</label>';
 return `<form data-book-browse hidden><div class="book-filters">${field('query','<input type="search" name="q" maxlength="512">')}${field('tag','<input name="tag" maxlength="512" list="public-tags"><datalist id="public-tags">'+[...new Set(records.flatMap(r=>r.tags))].sort().map(t=>'<option value="'+esc(t)+'"></option>').join('')+'</datalist>')}${field('journey','<select name="journey">'+choices(BOOK_JOURNEYS.filter(j=>j!=='all'),text)+'</select>')}${field('type','<select name="type">'+choices([...new Set(records.map(r=>r.type))].sort(),v=>v)+'</select>')}${field('from','<input type="date" name="from">')}${field('to','<input type="date" name="to">')}</div><button class="site-visitor-button" type="reset">${esc(text('reset'))}</button><p data-filter-error role="alert" hidden>${esc(text('filterError'))}</p><p role="status">${esc(text('count'))}: <span data-book-count>${records.length}</span></p></form><p data-book-empty hidden>${esc(text('noMatches'))}</p>`+browseRows(records,esc);
}
function pagedBrowse(records,esc,page){
 const field=(key,html)=>'<label>'+esc(text(key))+html+'</label>',{filters}=page;
 const input=(name,type='text')=>'<input name="'+name+'" type="'+type+'" value="'+esc(filters[name])+'" maxlength="512">';
 const query=new URLSearchParams(page.query),link=cursor=>{const params=new URLSearchParams(query);if(cursor)params.set('cursor',cursor);return 'browse.html'+(params.size?'?'+params:'');};
 const rows=browseRows(records,esc);
 const controls=[['previousResults',page.previousCursor],['nextResults',page.nextCursor]].filter(([,cursor])=>cursor).map(([key,cursor])=>'<a data-browse-'+(key==='previousResults'?'previous':'next')+' href="'+esc(link(cursor))+'">'+esc(text(key))+'</a>').join(' ');
 return '<form data-book-browse data-book-paged>'+ '<div class="book-filters">'+field('query',input('q','search'))+field('tag',input('tag'))+
  field('journey','<select name="journey"><option value="">'+esc(text('all'))+'</option>'+BOOK_JOURNEYS.filter(j=>j!=='all').map(j=>'<option value="'+j+'"'+(filters.journey===j?' selected':'')+'>'+esc(text(j))+'</option>').join('')+'</select>')+
  field('type',input('type'))+field('from',input('from','date'))+field('to',input('to','date'))+'</div><button class="site-visitor-button" type="submit">'+esc(text('applyFilters'))+'</button> <button class="site-visitor-button" type="reset">'+esc(text('reset'))+'</button><p data-filter-error role="alert" hidden>'+esc(text('filterError'))+'</p><p role="status">'+esc(text('pageRecords'))+': <span data-book-count>'+records.length+'</span></p></form>'+
  '<p data-book-empty'+(records.length?' hidden':'')+'>'+esc(text(page.nextCursor?'continueSearch':'noMatches'))+'</p>'+rows+'<nav class="book-page-navigation" aria-label="'+esc(text('browsePages'))+'">'+controls+'</nav>';
}
export function bookPageNavigation(records,record,esc){
 const peers=records.filter(r=>r.notebookId===record.notebookId),i=peers.findIndex(r=>r.id===record.id);
 return '<nav class="book-page-navigation" aria-label="'+esc(text('context'))+'"><a data-book-back href="../browse.html">'+esc(text('back'))+'</a>'+[['previous',peers[i-1]],['next',peers[i+1]]].map(([k,r])=>'<a data-book-'+k+' href="'+(r?r.id+'.html':'#')+'"'+(r?'':' hidden')+'>'+esc(text(k))+': <span data-book-name>'+esc(r?.title??'')+'</span></a>').join('')+'</nav>';
}
