import {randomUUID} from 'node:crypto';
import {RecordPreparationDrafts} from '../src/record-preparation-drafts.js';
import {preparation} from './fixtures/attempts.js';
export async function preparationCheckpoint(f,{count=70}={}){
 const owner=new RecordPreparationDrafts(f.workspace),id=randomUUID(),recordId=f.record.id,workspaceId=f.book.id,field='attempt:preparation:'+randomUUID(),base=await f.values.read({workspaceId,recordId,field}),selection={field,revision:base.revision,storageRevision:base.storageRevision};
 let command={workspaceId,recordId,selection,draft:null},opened=await owner.open(command),header={...opened.header,applicability:'Bounded acquisition preparation'},last;
 const change=async operations=>{last={...command,id,commandId:randomUUID(),operations};const result=await owner.change(last);command={...command,draft:result.draft};return result;};
 await change([{type:'header',value:header}]);const sample=preparation(),values={};
 for(const group of ['conditions','inputs','observations','criteria']){
  values[group]=Array.from({length:count},(_,i)=>({...sample[group][0],id:randomUUID(),...(group==='conditions'?{name:'Condition '+i}:{label:group+' '+i})}));
  for(let offset=0;offset<count;offset+=20)await change(values[group].slice(offset,offset+20).map(value=>({type:'append',collection:group,value})));
 }
 return {owner,id,header,values,get command(){return command;},get last(){return last;},change};
}
