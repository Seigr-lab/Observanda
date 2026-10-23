import {aggregationSourceKey} from './dataset-aggregation.js';
// Each retained group pins a sequence of source positions. Later inspection
// seeks that sequence directly; it never rescans preceding source rows.
import {datasetColumnCount,selectedDatasetColumns} from './dataset-selected-columns.js';
import {AppError} from './errors.js';
import {validAggregation,aggregationKey} from './web/dataset-aggregation-model.js';
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
export async function aggregationMemberContext(materials,doc){
 const recipe=doc.content.aggregation,source=await materials.read(recipe.source);
 if(!validAggregation(recipe,datasetColumnCount(source)))fail();
 const selection=await selectedDatasetColumns(materials,source,[...new Set([...recipe.keys,...recipe.values.map(v=>v.column)])]),columns=selection.columns;
 const index=doc.content.aggregationMembersIndex;materials.sequences.validate(index);
 if(index.kind!=='aggregation-members'||index.count!==source.content.rowCount)fail();
 return {recipe,source,columns,indices:selection.indices,index,cachedPage:null,cachedData:null,memberPage:null};
}
export async function* aggregationMemberRows(materials,context,row,{offset=0,limit=null,signal}={}){
 const members=row.aggregationMembers;
 if(!members||Object.keys(members).sort().join()!=='count,offset'||!Number.isSafeInteger(members.count)||members.count<1||!Number.isSafeInteger(members.offset)||members.offset<0||members.offset>context.index.count-members.count||typeof row.locator?.key!=='string'||
  !Array.isArray(row.aggregation)||row.aggregation.length!==context.recipe.values.length||row.aggregation.some(v=>v.total!==members.count))fail();
 if(!Number.isSafeInteger(offset)||offset<0||offset>members.count||limit!==null&&(!Number.isSafeInteger(limit)||limit<1))throw new AppError('INVALID');
 const end=limit===null?members.count:Math.min(members.count,offset+limit);let previous=null;
 // Include one preceding position to validate ordering across inspection pages.
 for(let at=Math.max(0,offset-1);at<end;){
  signal?.throwIfAborted();const absolute=members.offset+at,start=absolute-absolute%64;
  if(context.memberPage?.offset!==start)context.memberPage=await materials.sequences.page(context.index,{offset:start,limit:64});
  const positions=context.memberPage.items.slice(absolute-start,Math.min(64,absolute-start+end-at));
  if(!positions.length)fail();
  for(const position of positions){
   signal?.throwIfAborted();
   if(!position||Object.keys(position).sort().join()!=='page,row'||!Number.isSafeInteger(position.page)||position.page<0||position.page>=materials.datasetPageCount(context.source)||
    !Number.isSafeInteger(position.row)||position.row<0||previous&&(position.page<previous.page||position.page===previous.page&&position.row<=previous.row))fail();
   previous=position;
   if(at++<offset)continue;
   if(context.cachedPage!==position.page){context.cachedData=await materials.retainedDatasetPage(context.source,position.page,{columns:context.indices});context.cachedPage=position.page;}
   const value=context.cachedData.rows[position.row];
   if(!value||await aggregationSourceKey(materials,value,context.columns,context.recipe,{signal})!==row.locator.key)fail();
   yield {...position,value};
  }
 }
}
