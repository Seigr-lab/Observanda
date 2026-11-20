import {randomUUID} from 'node:crypto';
import {renderingSample} from './fixtures/rendering-book.js';
export function indexedBook(count=601){
 // Rendered straight from memory, so the book carries the renderer's page settings.
 const book=renderingSample(),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Reading '+String(i).padStart(4,'0'),body:'Shared observation '+i,share:true,tags:[i%13?'ordinary':'needle'],type:'observation',occurredOn:'2026-10-09',sections:[],figures:[],attachments:[],relations:[]}));
 book.entries.push({...structuredClone(seed),id:randomUUID(),title:'PRIVATE_RECORD_SENTINEL',body:'PRIVATE_BODY_SENTINEL',share:false,sections:[],figures:[],attachments:[],relations:[]});
 return book;
}
