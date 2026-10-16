import {bookText} from './web/book-messages.js';
import {publicationCollection} from './web/publication-collections.js';
import {staticCollectionNavigation} from './publication-collection-pages.js';

export function publicationCollectionNavigation(context,key,fragment,esc){
 const page=publicationCollection(context,key);
 if(page?.staticPage)return staticCollectionNavigation(page.staticPage,fragment,esc);
 if(!page||!page.previousCursor&&!page.nextCursor)return '';
 const link=cursor=>{const params=new URLSearchParams(context.collectionQuery);params.set('collection',key);params.set('cards',cursor);return '?'+params+'#'+fragment;};
 const buttons=[['previous',page.previousCursor],['next',page.nextCursor]].filter(([,cursor])=>cursor).map(([direction,cursor])=>'<a data-collection-'+direction+' href="'+esc(link(cursor))+'">'+esc(bookText(direction==='previous'?'previousResults':'nextResults'))+'</a>').join(' ');
 return '<nav class="book-page-navigation" data-record-collection="'+esc(key)+'"'+(page.definition?' data-collection-definition="'+esc(page.definition)+'"':'')+' aria-label="'+esc(bookText('collectionPages'))+'">'+
  (!page.recordIds.length?'<p>'+esc(bookText(page.nextCursor?'continueSearch':'noMatches'))+'</p>':'')+buttons+'</nav>';
}
