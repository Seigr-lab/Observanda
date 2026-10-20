import {preparationHeader,preparationPage,preparationRowById} from './record-preparation-document.js';
// A comparison reads its three narrative fields and independently paged
// methods/current facts. It never reconstructs the selected record bodies.
import {AppError} from './errors.js';
import {proseText} from './web/prose-model.js';
import {RecordAttemptIndex} from './record-attempt-index.js';
import {RecordMethodIndex} from './record-method-index.js';
import {withRecordProjectionScratch} from './record-projection-scratch.js';
import {RUN_DETAIL_PAGE_SIZE} from './web/record-runs.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
async function windowOf(document,path,offset,accept,project,{signal}={}){
 let total=0,last=null;const selected=[];
 for await(const item of document.items(path,{signal})){
  if(!await accept(item))continue;
  if(total>=offset&&selected.length<RUN_DETAIL_PAGE_SIZE)selected.push(item);last=item;total++;
 }
 offset=Math.min(offset,Math.max(0,total-1));if(!selected.length&&last)selected.push(last);
 const values=[];for(const item of selected){signal?.throwIfAborted();values.push(await project(item));}
 return {values,page:{offset,total,count:values.length}};
}
export async function recordRunComparison(document,{windows={},signal}={}){
 const attempt=await document.reference(['attempt'],{signal}),retained=await RecordAttemptIndex.open(document,{signal});
 if(attempt&&!retained)return withRecordProjectionScratch(document,async scratch=>{scratch.methodIndex=document.methodIndex;return read(scratch,new RecordAttemptIndex(scratch,await RecordAttemptIndex.retain(scratch,{signal})),windows,signal);},{signal});
 return read(document,retained,windows,signal);
}
async function read(document,index,windows,signal){
 const result={parameters:'',changes:'',deviations:'',methods:[],attempt:null,windows:{}},titles=new Map([['Parameters and conditions','parameters'],['Purpose and planned changes','changes'],['Observed deviations','deviations']]);
 for await(const item of document.items(['sections'],{signal})){
  const title=(await document.tree.selected(item.value,['title'])).value,key=titles.get(title);if(!key)continue;
  result[key]=proseText((await document.tree.selected(item.value,['body'])).value);titles.delete(title);if(!titles.size)break;
 }
 const methodIndex=await RecordMethodIndex.open(document,{signal}),methods=methodIndex?await methodIndex.window({offset:windows.methods??0,limit:RUN_DETAIL_PAGE_SIZE,signal}):await windowOf(document,['relations'],windows.methods??0,async item=>(await document.tree.selected(item.value,['role'])).value==='uses-method',async item=>({label:(await document.tree.selected(item.value,['label'])).value,revision:(await document.tree.selected(item.value,['target','revision'])).value}),{signal});
 result.methods=methods.values;result.windows.methods=methods.page;
 for(const group of ['conditions','events','assessments'])result.windows[group]={offset:0,total:0,count:0};
 if(!index)return result;
 const total=index.value.preparations,reference=total?await document.reference(['attempt','preparations',String(total-1)],{signal}):null,preparation=reference?await preparationHeader(document,reference,{signal}):null,conditions=reference?await preparationPage(document,reference,'conditions',{offset:windows.conditions??0,signal}):{items:[],offset:0,total:0};result.windows.conditions={offset:conditions.offset,total:conditions.total,count:conditions.items.length};
 result.attempt={preparationId:preparation?.id??null,preparationNumber:total,applicability:preparation?.applicability??'',conditions:conditions.items.map(({value:{id,name,value,unit,basis}})=>({id,name,value,unit,basis})),events:[],assessments:[]};
 for(const group of ['events','assessments']){
  const current=async item=>!await index.correction((await document.tree.selected(item.value,['id'])).value);
  const project=async item=>{
   const value=await document.tree.read(item.value);
   if(group==='events'){const {kind,label,extent,context}=value;return {kind,label,extent,context};}
   const row=await index.fact(value.preparationId,'preparations');if(!row)fail();
   const found=await index.nested(value.preparationId,'criteria',value.criterionId),c=found?await document.tree.read(found.reference):(await preparationRowById(document,await document.reference(['attempt','preparations',String(row.position)],{signal}),'criteria',value.criterionId,{signal}))?.value;if(!c)fail();
   return {criterion:c.label,preparationId:value.preparationId,preparationNumber:row.position+1,expected:c.expected,comparator:c.comparator,scope:c.scope,outcome:value.outcome,domainOutcome:value.domainOutcome,observed:value.observed,denominator:value.denominator};
  };
  if(index.value.version>=2){
   const selected=await index.currentWindow(group,{offset:windows[group]??0,limit:RUN_DETAIL_PAGE_SIZE,signal}),values=[];
   for(const row of selected.rows){signal?.throwIfAborted();values.push(await project({index:row.position,value:await document.reference(['attempt',group,String(row.position)],{signal})}));}
   result.attempt[group]=values;result.windows[group]={offset:selected.offset,total:selected.total,count:values.length};
  }else{
   const page=await windowOf(document,['attempt',group],windows[group]??0,current,project,{signal});result.attempt[group]=page.values;result.windows[group]=page.page;
  }
 }
 return result;
}
