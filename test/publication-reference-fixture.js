import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {recordRevision} from '../src/research.js';

export function referenceBook(count=53){
 const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0],notebook=book.notebooks.find(n=>n.id===seed.notebookId);
 book.notebooks=[notebook,{...structuredClone(notebook),id:randomUUID(),title:'Second source book'}];
 for(const project of book.projects)project.share=true;
 const target={...structuredClone(seed),id:randomUUID(),title:'Reference target',body:'A stable scientific definition.',sections:[],relations:[],attachments:[],figures:[],share:true,tags:[]};
 book.entries=[target,...Array.from({length:count},(_,i)=>({...structuredClone(target),id:randomUUID(),type:i%3===1?'run':'note',notebookId:book.notebooks[i%2].id,title:'Referring record '+String(i).padStart(4,'0'),relations:[{id:randomUUID(),label:target.title,type:'Related to',...(i%3?{role:['','run-of','compares'][i%3]}:{}),target:{workspaceId:book.id,kind:'record',id:target.id,...(i%3===2?{revision:recordRevision(target)}:{})}}]}))];
 book.website.home.enabled=false;book.pages=[];book.website.home.sections=[];book.website.footer='Retained reference edition';
 return book;
}
