import {randomUUID} from 'node:crypto';
import {indexedBook} from './publication-index-fixture.js';

export function notebookDirectoryBook(count=53){
 const book=indexedBook(count),seed=book.notebooks.find(n=>n.id===book.entries[0].notebookId);
 book.notebooks=Array.from({length:count},(_,index)=>({...structuredClone(seed),id:randomUUID(),title:'Lab book '+String(index).padStart(4,'0')}));
 for(const [index,record] of book.entries.slice(0,count).entries())record.notebookId=book.notebooks[index].id;
 const privateBook={...structuredClone(seed),id:randomUUID(),title:'PRIVATE_BOOK_SENTINEL'};
 book.notebooks.push(privateBook);book.entries.at(-1).notebookId=privateBook.id;
 book.website.home.sections=[];
 return book;
}
