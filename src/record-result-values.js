import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {resultValueId} from './web/record-result-value.js';
import {validateResultSources} from './result-statements.js';

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
export async function findResultFigure(document,id,{signal}={}){
 if(!id)return null;const count=await document.tree.arrayLength(document.root,['figures']);
 for(let position=0;position<count;position++){signal?.throwIfAborted();const found=(await resultFigureTargets(document,position,{signal})).find(f=>f.id===id);if(found)return found;}
 return null;
}
export async function selectedResultValue(document,field,{signal}={}){
 const id=resultValueId(field);let position=-1,value={value:null};
 if(await document.tree.select(document.root,['results','statements']))for await(const item of document.items(['results','statements'],{signal})){
  if((await document.tree.selected(item.value,['id'])).value===id){position=item.index;value={value:await document.tree.read(item.value)};break;}
 }
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
