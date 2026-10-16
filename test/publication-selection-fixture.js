import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {researchReference} from '../src/web/research-reference.js';
export function selectionBook(count=2){
 const book=upgradeNotebook(sampleNotebook()),record=book.entries[0],secret=book.entries[2];
 record.body='WITHHELD_MAIN_WRITING';record.sections=[{id:randomUUID(),title:'Selected method',body:'Public steps for the method.'},{id:randomUUID(),title:'WITHHELD_SECTION_TITLE',body:'C:/Users/private/commands'}];
 record.template={id:randomUUID(),profileId:null,label:'Observation details',description:'',fields:['public','secret'].map(key=>({key,label:key==='public'?'Public measure':'WITHHELD_FIELD',type:'text',unit:'',required:false,choices:[]})),values:{public:'9007199254740993',secret:'WITHHELD_FIELD_VALUE'}};
 const other=book.entries[1];other.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'WITHHELD_LINK_LABEL',marks:[{type:'link',attrs:{title:'',target:'_self',nofollow:false,href:researchReference({workspaceId:book.id,kind:'record',id:record.id,selector:{version:1,kind:'section',id:record.sections[1].id}})}}]}]}]};
 secret.title='WITHHELD_RECORD_TITLE';secret.body='WITHHELD_RECORD_BODY';
 book.entries=[record,other,...Array.from({length:Math.max(0,count-2)},(_,i)=>({...structuredClone(other),id:randomUUID(),title:'Extra record '+i,body:'A selectable record'})),secret];
 return {book,record,other,secret};
}
