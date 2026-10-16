// A selection handle and optional single method reference replace growing
// browser arrays. Batches retain their original boundaries for receipt replay.
import {materialReference} from './material-reference.js';
import {t} from './i18n/index.js';
export const selectionSize=source=>(source?.count??0)+(source?.extra?.length??0);
export async function selectionBatch(call,source,offset,{signal}={}){
 const count=selectionSize(source),items=[];
 if(!Number.isSafeInteger(offset)||offset<0||offset>=count)throw Error(t('materialSources','invalid'));
 if(offset<source.count){
  const page=await call('selection-page',{recordId:source.recordId,kind:source.kind,selection:source.selection,offset,limit:Math.min(64,source.count-offset)},{signal,adopt:false});
  if(page.count!==source.count||page.items.length!==Math.min(64,source.count-offset))throw Error(t('materialSources','loadFailed'));
  items.push(...page.items.map(materialReference));
 }
 if(items.length<64)items.push(...(source.extra??[]).slice(Math.max(0,offset-source.count),Math.max(0,offset-source.count)+64-items.length));
 return items;
}
