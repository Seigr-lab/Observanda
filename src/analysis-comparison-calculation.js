import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {analysisIdentity,ANALYSIS_CATEGORIES} from './web/analysis-model.js';
import {analysisObservations} from './analysis-observations.js';
import {ComparisonIndex} from './analysis-comparison-index.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {validTableRef} from './analysis-comparison-table.js';
import {researchId} from './web/research-reference.js';
import messages from './web/locales/en/analyses.json' with {type:'json'};

export const comparisonGroupKey=o=>JSON.stringify([analysisIdentity(o.investigation),analysisIdentity(o.run),o.condition,o.operation,o.profile,analysisIdentity(o.calibration),o.unit,o.membership,o.window,o.windowRelation,o.evidence]);
const counts=()=>Object.fromEntries(ANALYSIS_CATEGORIES.map(k=>[k,0]));
const groupFields=o=>Object.fromEntries(['investigation','run','condition','operation','profile','calibration','unit','membership','window','windowRelation','evidence'].map(k=>[k,o[k]]));
const blank=ordering=>({version:2,algorithm:'observanda-exception-comparison',algorithmVersion:'2',ordering,rows:0,raw:counts(),aggregate:counts(),runs:0,unknownRunRows:0,counts:{groups:0,distribution:0,transitions:0,observations:0},verification:null});
const natural=value=>Number.isSafeInteger(value)&&value>=0;
function validateCheckpoint(state,command,sourceRows){
 const s=state?.summary,last=state?.last,total=sourceRows.reduce((a,b)=>a+b,0);
 if(!sourceRows.every(natural)||!natural(total))throw new AppError('ANALYSIS_LIMIT');
 const validCounts=value=>value&&Object.keys(value).length===ANALYSIS_CATEGORIES.length&&ANALYSIS_CATEGORIES.every(k=>natural(value[k]));
 if(state?.version!==1||typeof state.complete!=='boolean'||!validTableRef(state.root)||s?.version!==2||s.algorithm!=='observanda-exception-comparison'||s.algorithmVersion!=='2'||s.ordering!==command.comparison.ordering||!natural(s.rows)||s.rows>total||!validCounts(s.raw)||!validCounts(s.aggregate)||Object.values(s.raw).reduce((a,b)=>a+b,0)+Object.values(s.aggregate).reduce((a,b)=>a+b,0)!==s.rows||!natural(s.runs)||!natural(s.unknownRunRows)||s.runs+s.unknownRunRows>s.rows||!s.counts||!['groups','distribution','transitions','observations'].every(k=>natural(s.counts[k])&&s.counts[k]<=s.rows)||s.counts.observations!==s.rows||Boolean(state.root)!==Boolean(s.rows)||state.complete&&s.rows!==total)throw new AppError('MATERIAL_MISSING');
 if(s.rows===0){if(last!==null)throw new AppError('MATERIAL_MISSING');return;}
 if(!last||!['source','page','row','count'].every(k=>natural(last[k]))||last.source>=sourceRows.length||last.count<1||last.count>sourceRows[last.source]||sourceRows.slice(0,last.source).reduce((a,b)=>a+b,0)+last.count!==s.rows)throw new AppError('MATERIAL_MISSING');
}

// A checkpoint and all table/index writes share the same fenced transaction.
// Losing a process can repeat at most one batch; nothing is published until
// the completed small manifest becomes an ordinary retained analysis revision.
export async function calculateComparison(owner,command,{signal,progress=async()=>{},jobId=null,writePage,sequences=owner.materials.sequences,checkpoint=true}={}){
 const workspace=owner.materials.workspace,commandHash=digest(revisionText(command));
 if(jobId!==null&&!researchId(jobId))throw new AppError('INVALID');
 const file=jobId&&checkpoint?'.observanda/materials/comparison-work/'+jobId+'.json':null;
 writePage??=fn=>workspace.withLock(()=>withWorkspaceMetadataBatch(workspace,fn));
 let state={version:1,commandHash,root:null,last:null,summary:blank(command.comparison.ordering),complete:false};
 if(file){const raw=await workspace.readMetadata(file,1048576);if(raw!==null){try{state=JSON.parse(raw);}catch{throw new AppError('MATERIAL_MISSING');}if(state?.commandHash!==commandHash)throw new AppError('MATERIAL_CHANGED');}}
 const sourceRows=[];for(const source of command.comparison.sources)sourceRows.push((await owner.materials.read(source.dataset)).content.rowCount);
 validateCheckpoint(state,command,sourceRows);
 const index=new ComparisonIndex(sequences,state.root),total=sourceRows.reduce((a,b)=>a+b,0);
 async function append(o){
  for(const name of ['condition','operation','profile','window'])if(o[name].length>300)throw new AppError('ANALYSIS_LIMIT');
  const s=state.summary,key=comparisonGroupKey(o);
  if(o.run){if(!await index.state('runs',o.run.id)){await index.state('runs',o.run.id,true);s.runs++;}}else s.unknownRunRows++;
  s[o.evidence][o.category]++;s.rows++;
  const existing=await index.get('groups',key),group=existing?.value??{key,...groupFields(o),rows:0,categories:counts(),boundaries:{unknown:0,below:0,above:0,'on-boundary':0,inside:0},assessed:0,successful:0};
  group.rows++;group.categories[o.category]++;group.boundaries[o.boundary]++;
  if(o.evidence==='raw'&&['correct','mismatched'].includes(o.category)){group.assessed++;if(o.category==='correct')group.successful++;}
  if(await index.put('groups',key,group,s.counts.groups))s.counts.groups++;
  if(o.available){
   const canonical=o.exact?o.exact.numerator+'/'+o.exact.denominator:o.value,identity=JSON.stringify([key,canonical,o.category]);
   if(canonical.length>8192)throw new AppError('ANALYSIS_LIMIT');
   const previous=await index.get('distribution',identity),value=previous?.value??{group:key,value:o.value,exact:o.exact,category:o.category,count:0,locator:o.locator};value.count++;
   if(await index.put('distribution',identity,value,s.counts.distribution,index.filters('distribution',o.category,key)))s.counts.distribution++;
  }
  if(command.comparison.ordering==='source'){
   const stream=JSON.stringify([o.source,key]),before=await index.state('previous',stream);
   if(before){const identity=JSON.stringify([stream,before.category,o.category]),prior=await index.get('transitions',identity),value=prior?.value??{source:o.source,group:key,from:before.category,to:o.category,count:0,before:before.locator,after:o.locator};value.count++;
    if(await index.put('transitions',identity,value,s.counts.transitions,[...index.filters('transitions',before.category,key),...index.filters('transitions',o.category,key)]))s.counts.transitions++;
   }
   await index.state('previous',stream,{category:o.category,locator:o.locator});
  }
  const filters=index.filters('all',o.category,key);
  if(o.category!=='correct')filters.push(...index.filters('exceptions',o.category,key));
  if(o.boundary!=='unknown')filters.push(...index.filters('boundary',o.category,key));
  await index.put('observations',String(s.counts.observations),o,s.counts.observations,filters);s.counts.observations++;
  state.last={source:o.source,page:o.page,row:o.row,count:state.last?.source===o.source?state.last.count+1:1};
 }
 async function retain(batch){await writePage(async()=>{signal?.throwIfAborted();for(const observation of batch){signal?.throwIfAborted();await append(observation);}state.root=await index.flush();if(file)await workspace.writeMetadata(file,serialize(state));});}
 if(!state.complete){
  let batch=[],bytes=0;
  for await(const observation of analysisObservations(owner.materials,command.comparison,{signal,start:state.last})){
   const size=Buffer.byteLength(serialize(observation));if(batch.length&&(batch.length===32||bytes+size>262144)){await retain(batch);await progress({stage:messages.comparingStage,done:state.summary.rows,total});batch=[];bytes=0;}
   batch.push(observation);bytes+=size;
  }
  if(batch.length)await retain(batch);signal?.throwIfAborted();
  if(command.comparison.expected)state.summary.verification=await owner.verifyExpected(command.comparison,{signal});
  state.complete=true;await retain([]);
 }
 if(state.summary.rows!==total)throw new AppError('MATERIAL_MISSING');
 await progress({stage:messages.retainingStage,done:total,total});
 return {commandHash,...(file?{workId:jobId}:{}),content:{inputs:owner.references(command.method,command.comparison),tool:command.tool,version:command.version,parameters:'',method:command.method,comparison:command.comparison,summary:{...state.summary,index:{version:1,root:state.root}}}};
}
