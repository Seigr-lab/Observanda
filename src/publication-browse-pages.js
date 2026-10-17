import {createHash} from 'node:crypto';
import {browseRows} from './publication-browse-rows.js';
import {PUBLIC_INDEX_ROWS,publicIndexPath} from './web/public-browse-pages.js';
import {BOOK_JOURNEYS} from './web/book-journeys.js';
import {bookText as text} from './web/book-messages.js';

export function* publicationIndexPages(records,esc){
 const hash=createHash('sha256');for(const record of records)hash.update(JSON.stringify(record)+'\n');
 const identity=hash.digest('hex'),pages=Math.ceil(records.length/PUBLIC_INDEX_ROWS);
 for(let page=0;page<pages;page++){
  yield publicationIndexPage(records.slice(page*PUBLIC_INDEX_ROWS,(page+1)*PUBLIC_INDEX_ROWS),{identity,page,total:records.length},esc);
 }
}

export function publicationIndexPage(rows,{identity,page,total},esc){
 const pages=Math.ceil(total/PUBLIC_INDEX_ROWS),config={version:1,identity,page,pages,pageSize:PUBLIC_INDEX_ROWS,total,messages:Object.fromEntries(['indexLoading','indexFailed','pageRecords','filterError'].map(k=>[k,text(k)]))};
  const field=(key,html)=>'<label>'+esc(text(key))+html+'</label>',input=(name,type='text')=>'<input name="'+name+'" type="'+type+'" maxlength="512">';
  const controls='<div class="book-filters">'+field('query',input('q','search'))+field('tag',input('tag'))+field('journey','<select name="journey"><option value="">'+esc(text('all'))+'</option>'+BOOK_JOURNEYS.filter(j=>j!=='all').map(j=>'<option value="'+j+'">'+esc(text(j))+'</option>').join('')+'</select>')+field('type',input('type'))+field('from',input('from','date'))+field('to',input('to','date'))+'</div>';
  const navigation=[['previousResults',page-1,page===0],['nextResults',page+1,page+1===pages]].map(([key,index,hidden])=>'<a data-index-'+(key==='previousResults'?'previous':'next')+' href="'+esc(publicIndexPath(Math.max(0,index)))+'"'+(hidden?' hidden':'')+'>'+esc(text(key))+'</a>').join(' ');
 return {path:publicIndexPath(page),content:'<form data-book-browse data-book-static="'+esc(JSON.stringify(config))+'" hidden>'+controls+'<button type="submit">'+esc(text('applyFilters'))+'</button> <button type="reset">'+esc(text('reset'))+'</button><p data-filter-error role="alert" hidden>'+esc(text('filterError'))+'</p></form><p data-index-status role="status">'+esc(text('pageRecords'))+': '+rows.length+'</p><button data-index-cancel hidden>'+esc(text('cancel'))+'</button><button data-index-retry hidden>'+esc(text('indexRetry'))+'</button><p data-book-empty hidden>'+esc(text('noMatches'))+'</p>'+browseRows(rows,esc)+'<nav class="book-page-navigation" aria-label="'+esc(text('browsePages'))+'">'+navigation+'</nav>'};
}
