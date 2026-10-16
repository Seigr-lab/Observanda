import {PUBLIC_COLLECTION_ROWS,collectionPagePath} from './web/public-collection-pages.js';
import {bookText} from './web/book-messages.js';

export function* publicationCollectionWindows(records,target){
 const total=records.length;
 for(let page=0;page<Math.max(1,Math.ceil(total/PUBLIC_COLLECTION_ROWS));page++){
  const selected=records.slice(page*PUBLIC_COLLECTION_ROWS,(page+1)*PUBLIC_COLLECTION_ROWS);
  yield {key:'body',recordIds:selected.map(r=>r.id),staticPage:{target,page,total}};
 }
}
export function staticCollectionNavigation({target,page,total},fragment,esc){
 const pages=Math.max(1,Math.ceil(total/PUBLIC_COLLECTION_ROWS));if(pages===1)return '';
 const link=number=>collectionPagePath(target,number).split('/').at(-1)+'#'+fragment;
 return '<nav class="book-page-navigation" data-record-collection="body" aria-label="'+esc(bookText('collectionPages'))+'">'+
  '<a data-collection-previous href="'+esc(link(Math.max(0,page-1)))+'"'+(page===0?' hidden':'')+'>'+esc(bookText('previousResults'))+'</a> '+
  '<a data-collection-next href="'+esc(link(Math.min(pages-1,page+1)))+'"'+(page+1===pages?' hidden':'')+'>'+esc(bookText('nextResults'))+'</a></nav>';
}
