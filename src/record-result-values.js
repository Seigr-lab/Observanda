import {resultDocumentPosition} from './record-result-document.js';
import {AppError} from './errors.js';
import {RETAINED_FIGURE_WINDOW} from './web/retained-figure-model.js';
import {digest,serialize} from './storage-format.js';
import {resultValueId} from './web/record-result-value.js';
import {validateResultSources} from './result-statements.js';
import {findRetainedFigureTarget,retainedFigureRootTarget,retainedFigureTargetPage} from './retained-figure-targets.js';

// Figure choices carry names and identities only, never embedded observations.
export async function resultFigureTargets(document,position,{signal}={}){
 const path=['figures',String(position)],field=async parts=>(await document.field([...path,...parts],{signal})).value;
 const id=await field(['id']),title=await field(['title']);if(!id)return [];
 const targets=[{id,title}];
 if(await field(['kind'])==='panels')for await(const panel of document.items([...path,'panels'],{signal})){
  const get=async parts=>(await document.tree.selected(panel.value,parts)).value;
  targets.push({id:await get(['figure','id']),title:title+' · '+await get(['label'])+' · '+await get(['figure','title'])});
 }
 return targets;
}
// Top-level choices and child pages keep independent offsets. Retained roots
// contain only a compact descriptor; inline panels are read by header fields.
async function retainedDescriptor(document,path,{signal}={}){
 const figure={};for(const name of ['id','title','kind','version','document'])figure[name]=(await document.field([...path,name],{signal})).value;return figure;
}
const titleText=value=>typeof value==='string'?value.length>512?value.slice(0,512)+'...':value:value?.format==='figure-text'?value.preview+'...':'';
export async function resultFigureRootTarget(document,position,{signal}={}){
 const path=['figures',String(position)],field=async parts=>(await document.field([...path,...parts],{signal})).value;
 const id=await field(['id']);if(!id)return null;const kind=await field(['kind']);
 if(kind==='retained')return retainedFigureRootTarget(document.blocks,await retainedDescriptor(document,path,{signal}),{signal});
 return {id,title:titleText(await field(['title'])),hasPanels:kind==='panels'};
}
export async function resultFigureTargetPage(document,position,{offset=0,limit=4,signal}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>RETAINED_FIGURE_WINDOW)throw new AppError('INVALID');
 const path=['figures',String(position)],field=async parts=>(await document.field([...path,...parts],{signal})).value,kind=await field(['kind']);
 if(kind==='retained')return retainedFigureTargetPage(document.blocks,await retainedDescriptor(document,path,{signal}),{offset,limit,signal});
 const items=[],total=kind==='panels'?await document.tree.arrayLength(document.root,[...path,'panels']):0,title=titleText(await field(['title']));offset=Math.min(offset,Math.max(0,total-1));
 if(kind==='panels')for await(const panel of document.items([...path,'panels'],{offset,limit,signal})){
  const get=async parts=>(await document.tree.selected(panel.value,parts)).value;items.push({id:await get(['figure','id']),title:[title,titleText(await get(['label'])),titleText(await get(['figure','title']))].filter(Boolean).join(' / '),hasPanels:false});
 }
 return {items,offset,total,next:offset+items.length<total?offset+items.length:null,previous:offset?Math.max(0,offset-limit):null};
}
export async function findResultFigure(document,id,{signal}={}){
 if(!id)return null;const count=await document.tree.arrayLength(document.root,['figures']);
 for(let position=0;position<count;position++){
  signal?.throwIfAborted();const path=['figures',String(position)],field=async parts=>(await document.field([...path,...parts],{signal})).value,kind=await field(['kind']);
  if(kind==='retained'){const found=await findRetainedFigureTarget(document.blocks,await retainedDescriptor(document,path,{signal}),id,{signal});if(found)return found;continue;}
  const title=titleText(await field(['title']));if(await field(['id'])===id)return {id,title};
  if(kind==='panels')for await(const panel of document.items([...path,'panels'],{signal})){
   const get=async parts=>(await document.tree.selected(panel.value,parts)).value;if(await get(['figure','id'])===id)return {id,title:[title,titleText(await get(['label'])),titleText(await get(['figure','title']))].filter(Boolean).join(' / ')};
  }
 }
 return null;
}
export async function selectedResultValue(document,field,{signal}={}){
 const id=resultValueId(field),position=await resultDocumentPosition(document,id,{signal}),value={value:position<0?null:(await document.field(['results','statements',String(position)],{signal})).value};
 return {resultId:id,position,path:position<0?null:['results','statements',String(position)],value,revision:digest(serialize(value)),definition:{kind:'result',existing:position>=0,original:value.value,figureTarget:await findResultFigure(document,value.value?.figureId,{signal})}};
}
export async function replaceResultValue(document,value,selected){
 if(value.value===null)return selected.position<0?document:document.splice(['results','statements'],selected.position,1,[]);
 if(!(await document.tree.select(document.root,['results'])))document=await document.property([],'results',{version:1,statements:[]});
 return selected.position<0?document.splice(['results','statements'],await document.tree.arrayLength(document.root,['results','statements']),0,[value.value]):document.replace(selected.path,value.value);
}
export async function validateSelectedResult(workspace,document,value){
 if(value.value===null)return;
 const statement=value.value,target=await findResultFigure(document,statement.figureId);
 if(statement.kind==='figure'&&!target)throw new AppError('ANALYSIS_INVALID');
 await validateResultSources(workspace,{results:{version:1,statements:[statement]},figures:target?[target]:[]});
}
