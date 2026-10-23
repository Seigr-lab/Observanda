import {serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {analysisIdentity} from './web/analysis-model.js';
export const comparisonGroupKey=(o,version=1)=>JSON.stringify([analysisIdentity(o.investigation,version),analysisIdentity(o.run,version),o.condition,o.operation,o.profile,analysisIdentity(o.calibration,version),o.unit,o.membership,o.window,o.windowRelation,o.evidence]);
const groupFields=o=>Object.fromEntries(['investigation','run','condition','operation','profile','calibration','unit','membership','window','windowRelation','evidence'].map(k=>[k,o[k]]));
const counts=()=>({correct:0,mismatched:0,unresolved:0,unavailable:0,excluded:0});
// Calculation and owner-only integrity use the same deterministic accumulator.
// Integrity supplies retained observations, not another read of source datasets.
export function comparisonAccumulator(index,state,comparison){
 const put=async(table,key,value,count,filters)=>{if(comparison.version===3&&Buffer.byteLength(serialize({table,key,value,ordinal:count}))>1048576)throw new AppError('ANALYSIS_LIMIT');return index.put(table,key,value,count,filters);};
 async function append(o){
  for(const name of ['condition','operation','profile','window'])if(o[name].length>300)throw new AppError('ANALYSIS_LIMIT');
  const s=state.summary,key=comparisonGroupKey(o,comparison.version);
  if(o.run){const identity=comparison.version>=2?state.summary.sourceIdentities[o.source].run:o.run,run=comparison.version>=2?JSON.stringify([identity.workspaceId,identity.kind,identity.id]):identity.id;if(!await index.state('runs',run)){await index.state('runs',run,true);s.runs++;}}else s.unknownRunRows++;
  s[o.evidence][o.category]++;s.rows++;
  const existing=await index.get('groups',key),group=existing?.value??{key,...groupFields(o),rows:0,categories:counts(),boundaries:{unknown:0,below:0,above:0,'on-boundary':0,inside:0},assessed:0,successful:0};
  group.rows++;group.categories[o.category]++;group.boundaries[o.boundary]++;
  if(o.evidence==='raw'&&['correct','mismatched'].includes(o.category)){group.assessed++;if(o.category==='correct')group.successful++;}
  if(await put('groups',key,group,s.counts.groups))s.counts.groups++;
  if(o.available){
   const canonical=o.exact?o.exact.numerator+'/'+o.exact.denominator:o.value,identity=JSON.stringify([key,canonical,o.category]);
   if(comparison.version!==3&&canonical.length>8192)throw new AppError('ANALYSIS_LIMIT');
   const previous=await index.get('distribution',identity),value=previous?.value??{group:key,value:o.value,exact:o.exact,category:o.category,count:0,locator:o.locator};value.count++;
   if(await put('distribution',identity,value,s.counts.distribution,index.filters('distribution',o.category,key)))s.counts.distribution++;
  }
  if(comparison.ordering==='source'){
   const stream=JSON.stringify([o.source,key]),before=await index.state('previous',stream);
   if(before){const identity=JSON.stringify([stream,before.category,o.category]),prior=await index.get('transitions',identity),value=prior?.value??{source:o.source,group:key,from:before.category,to:o.category,count:0,before:before.locator,after:o.locator};value.count++;
    if(await put('transitions',identity,value,s.counts.transitions,[...index.filters('transitions',before.category,key),...index.filters('transitions',o.category,key)]))s.counts.transitions++;
   }
   await index.state('previous',stream,{category:o.category,locator:o.locator});
  }
  const filters=index.filters('all',o.category,key);
  if(o.category!=='correct')filters.push(...index.filters('exceptions',o.category,key));
  if(o.boundary!=='unknown')filters.push(...index.filters('boundary',o.category,key));
  await put('observations',String(s.counts.observations),o,s.counts.observations,filters);s.counts.observations++;
  state.last={source:o.source,page:o.page,row:o.row,count:state.last?.source===o.source?state.last.count+1:1};
 }
 return append;
}
