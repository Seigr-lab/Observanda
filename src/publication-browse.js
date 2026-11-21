import {matchesPublicRecord} from './web/public-browse-query.js';
import {enhancePublicBook} from './web/public-book.js';
import {enhancePublicIndex} from './web/public-index.js';
export const PUBLIC_BOOK_SCRIPT='('+enhancePublicBook.toString()+')(document,location,history,sessionStorage,window,'+matchesPublicRecord.toString()+','+enhancePublicIndex.toString()+');\n';
