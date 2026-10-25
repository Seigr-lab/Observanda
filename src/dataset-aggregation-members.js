import {quantileSelection} from './dataset-quantile.js';
import {resolveScalarDefinitions} from './measurement-scalar-storage.js';
import {resolveAggregationReceipts,validateAggregationReceipts} from './dataset-aggregation-quantiles.js';
import {revisionText} from './web/revision-model.js';
import {aggregationSourceKey} from './dataset-aggregation.js';
// Each retained group pins a sequence of source positions. Later inspection
// seeks that sequence directly; it never rescans preceding source rows.
import {datasetColumnCount,selectedDatasetColumns} from './dataset-selected-columns.js';
import {AppError} from './errors.js';
import {validAggregation,aggregationKey,aggregationPresence,isPairStatisticMetric,aggregationMetricColumns} from './web/dataset-aggregation-model.js';
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
export async function aggregationMemberContext(materials,doc){
 const recipe=doc.content.aggregation,source=await materials.read(recipe.source);
 if(!validAggregation(recipe,datasetColumnCount(source)))fail();
 const selection=await selectedDatasetColumns(materials,source,[...new Set([...recipe.keys,...recipe.values.flatMap(aggregationMetricColumns)])]),columns=selection.columns;
 const index=doc.content.aggregationMembersIndex;materials.sequences.validate(index);
 if(index.kind!=='aggregation-members'||index.count!==source.content.rowCount)fail();
 return {recipe,source,columns,indices:selection.indices,index,cachedPage:null,cachedData:null,memberPage:null};
}
export async function* aggregationMemberRows(materials,context,row,{offset=0,limit=null,signal}={}){
 validateAggregationReceipts(context.recipe,row);
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

// Two selected member reads suffice to resolve the private receipt's source cells.
// Full sorted-rank proof remains the deterministic complete replay verifier.
export async function aggregationQuantileDetails(materials,doc,row,metricIndex,{signal,context}={}){
 const recipe=doc.content.aggregation,metric=recipe?.values?.[metricIndex];
 if(![4,5,6,7].includes(recipe?.version)||metric?.operation!=='quantile')return {};
 validateAggregationReceipts(recipe,row);
 const counts=row.aggregation[metricIndex],receipt=counts.quantile;
 const result={metricIndex,method:metric.method,probability:metric.probability,quantile:null};
 const resolvedMetric=await resolveScalarDefinitions(materials,{version:recipe.version,resourcePolicy:recipe.resourcePolicy,values:[metric]},{signal}),selection=quantileSelection(counts.included,resolvedMetric.values[0].probability,recipe.resourcePolicy);
 if(receipt===null){if(selection!==null)fail();return result;}
 const resolved=(await resolveAggregationReceipts(materials,[counts],recipe.resourcePolicy,{signal}))[0].quantile;
 if(resolved.lower.rank!==selection.lower||resolved.upper.rank!==selection.upper||revisionText(resolved.weight)!==revisionText(selection.weight))fail();
 context??=await aggregationMemberContext(materials,doc);
 const point=async selected=>{let found;for await(const member of aggregationMemberRows(materials,context,row,{offset:selected.member,limit:1,signal}))found=member;
  if(!found||found.value.excluded||aggregationPresence(found.value,context.columns[context.indices.indexOf(metric.column)],metric.column)!=='value')fail();
  return {...selected,source:{ref:recipe.source,selector:{kind:'cell',page:found.page,row:found.row,column:metric.column}}};
 };
 result.quantile={...receipt,lower:await point(receipt.lower),upper:await point(receipt.upper)};return result;
}
