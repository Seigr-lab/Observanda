import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './collaboration.js';
export async function liveCreationFixture(t){
 const f=await collaborationFixture(t),templateId=randomUUID();
 await f.author.workspace.update(book=>{
  book.notebooks.find(n=>n.id===f.book.notebooks[0].id).configuration={profiles:[],sections:[{id:templateId,profileId:null,key:'acquisition',label:'Acquisition',description:'Retain the exact counter and assessment.',enabled:true,fields:[
   {key:'counter',label:'Exact counter',type:'number',unit:'ticks',required:true,choices:[]},
   {key:'accepted',label:'Accepted',type:'boolean',unit:'',required:true,choices:[]},
   {key:'conditions',label:'Conditions',type:'text',unit:'',required:false,choices:[]},
   {key:'reviewDate',label:'Review date',type:'date',unit:'',required:false,choices:[]},
   {key:'control',label:'Control setting',type:'select',unit:'',required:false,choices:['Open','Closed']}
  ]}]};return book;
 });
 return {...f,templateId};
}
export const creationCommand=(options,overrides={})=>{
 const choice=options.choices[0];return {id:randomUUID(),notebookId:options.notebookId,source:{kind:choice.kind,id:choice.id,revision:choice.revision},title:'Next acquisition',occurredOn:'2026-10-09',values:{counter:'9007199254740993.123456789',accepted:false,conditions:'Dark chamber'},...overrides};
};
