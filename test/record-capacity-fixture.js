import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,MAX_BYTES} from '../src/model.js';
import {serialize} from '../src/storage-format.js';
export function largeRecordBook(){
 const book=upgradeNotebook(sampleNotebook()),record={...book.entries[2],type:'note',title:'Large authored record',body:'',sections:[],figures:[],relations:[],attachments:[]};
 book.entries=[record];
 // Leave only 1 KiB below the current complete-workspace compatibility limit.
 for(let i=0;i<30;i++){
  const section={id:randomUUID(),title:'Observations '+i,body:''};record.sections.push(section);
  const remaining=MAX_BYTES-1024-Buffer.byteLength(serialize(book));
  section.body='界'.repeat(Math.min(60000,Math.max(0,Math.floor(remaining/3))));
  if(section.body.length<60000)break;
 }
 return book;
}
