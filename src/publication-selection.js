import {AppError} from './errors.js';
import {recordRevision} from './research.js';
import {publicationSource,publicationOriginal} from './publication-source.js';
import {validEditionSelection} from './web/publication-selection.js';

export function validateEditionSelection(value){if(!validEditionSelection(value))throw new AppError('INVALID');return value;}
export function validateEditionRecord(record,choice){
 if(!choice)return;
 if(choice.revision!==recordRevision(publicationOriginal(record)))throw new AppError('RECORD_CHANGED');
 const contains=(choices,items,key='id')=>choices.every(id=>items.some(item=>item[key]===id));
 if(!contains(choice.sections,record.sections)||!contains(choice.fields,record.template?.fields??[],'key')||!contains(choice.attachments,record.attachments)||!contains(choice.figures.map(f=>f.id),record.figures))throw new AppError('INVALID');
}
// Authenticated preparation inventory: labels and identities, never record
// bodies, field values, figure points, attachment bytes or private source paths.
export async function publicationSelection(workspace,{source,offset=0,cursor=null},{signal}={}){
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||!source||typeof source!=='object'||cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>4096))throw new AppError('INVALID');
 return publicationSource(workspace,source,{signal,inventory:true,page:{offset,limit:21,cursor},consume:async(metadata,records,context)=>{
  const items=[];let last;
  for await(const record of records){
   if(items.length===19)last=record;
   signal?.throwIfAborted();items.push(record);
  }
  const next=items.length>20?offset+20:null;
  return {items:items.slice(0,20),offset,next,nextCursor:next!==null&&context?.nextCursor?context.nextCursor(last,next):null};
 }});
}
