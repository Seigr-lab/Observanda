import {defaultFeed,orderFeed} from './web/website-feed-model.js';
import {PUBLIC_COLLECTION_ROWS} from './web/public-collection-pages.js';
import {bookText} from './web/book-messages.js';

// The default project directory uses the same independently paged reader as
// authored feeds. Only admitted lab books enter this owner, never workspace data.
export const pagedNotebookList=notebooks=>notebooks.length>PUBLIC_COLLECTION_ROWS;
export function publicationNotebooks(notebooks,{target,pageKey,feeds,esc}){
 const link=notebook=>'<a href="../notebooks/'+notebook.id+'.html">'+esc(notebook.title)+'</a>';
 if(!pagedNotebookList(notebooks))return '<ul class="notebook-list">'+notebooks.map(notebook=>'<li>'+link(notebook)+'</li>').join('')+'</ul>';
 const feed={...defaultFeed('pages'),pageSize:PUBLIC_COLLECTION_ROWS,visitorOrder:true,visitorFilters:true};
 Object.assign(feed.labels,{previous:bookText('previousBooks'),next:bookText('nextBooks'),search:bookText('searchBooks')});
 const section={kind:'notebooks',layout:'list',feed};
 const messageOverrides=Object.fromEntries(['loading','empty','results','pages'].map(key=>[key,bookText(key+'Books')]));
 return '<div class="project-book-directory">'+feeds.render({section,target,pageKey,key:'project-books',items:orderFeed(notebooks,'pages',feed.order),card:notebook=>'<article class="notebook-link">'+link(notebook)+'</article>',messageOverrides})+'</div>';
}
