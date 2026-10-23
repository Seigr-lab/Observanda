import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {ANALYSIS_CATEGORIES} from './web/analysis-model.js';
import {analysisObservations} from './analysis-observations.js';
import {validateComparisonSourceIdentities} from './analysis-comparison-identities.js';
import {comparisonAccumulator} from './analysis-comparison-accumulator.js';
export {comparisonGroupKey} from './analysis-comparison-accumulator.js';
import {ComparisonIndex} from './analysis-comparison-index.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {validTableRef} from './analysis-comparison-table.js';
import {researchId} from './web/research-reference.js';
import messages from './web/locales/en/analyses.json' with {type:'json'};

const counts=()=>Object.fromEntries(ANALYSIS_CATEGORIES.map(k=>[k,0]));
const algorithmVersion=comparison=>comparison.version===3?'4':comparison.version===2?'3':'2';
const blank=comparison=>({version:2,algorithm:'observanda-exception-comparison',algorithmVersion:algorithmVersion(comparison),ordering:comparison.ordering,rows:0,raw:counts(),aggregate:counts(),runs:0,unknownRunRows:0,counts:{groups:0,distribution:0,transitions:0,observations:0},verification:null});
const natural=value=>Number.isSafeInteger(value)&&value>=0;
function validateCheckpoint(state,command,sourceRows,sourceIdentities){
 const s=state?.summary,last=state?.last,total=sourceRows.reduce((a,b)=>a+b,0);
 if(!sourceRows.every(natural)||!natural(total))throw new AppError('ANALYSIS_LIMIT');
 if(command.comparison.version>=2&&(JSON.stringify(s?.sourceRows)!==JSON.stringify(sourceRows)||revisionText(s?.sourceIdentities)!==revisionText(sourceIdentities)))throw new AppError('MATERIAL_MISSING');
 const validCounts=value=>value&&Object.keys(value).length===ANALYSIS_CATEGORIES.length&&ANALYSIS_CATEGORIES.every(k=>natural(value[k]));
 if(state?.version!==1||typeof state.complete!=='boolean'||!validTableRef(state.root)||s?.version!==2||s.algorithm!=='observanda-exception-comparison'||s.algorithmVersion!==algorithmVersion(command.comparison)||s.ordering!==command.comparison.ordering||!natural(s.rows)||s.rows>total||!validCounts(s.raw)||!validCounts(s.aggregate)||Object.values(s.raw).reduce((a,b)=>a+b,0)+Object.values(s.aggregate).reduce((a,b)=>a+b,0)!==s.rows||!natural(s.runs)||!natural(s.unknownRunRows)||s.runs+s.unknownRunRows>s.rows||!s.counts||!['groups','distribution','transitions','observations'].every(k=>natural(s.counts[k])&&s.counts[k]<=s.rows)||s.counts.observations!==s.rows||Boolean(state.root)!==Boolean(s.rows)||state.complete&&s.rows!==total)throw new AppError('MATERIAL_MISSING');
 if(s.rows===0){if(last!==null)throw new AppError('MATERIAL_MISSING');return;}
 if(!last||!['source','page','row','count'].every(k=>natural(last[k]))||last.source>=sourceRows.length||last.count<1||last.count>sourceRows[last.source]||sourceRows.slice(0,last.source).reduce((a,b)=>a+b,0)+last.count!==s.rows)throw new AppError('MATERIAL_MISSING');
}

// A checkpoint and all table/index writes share the same fenced transaction.
// Losing a process can repeat at most one batch; nothing is published until
// the completed small manifest becomes an ordinary retained analysis revision.
export async function calculateComparison(owner,command,{signal,progress=async()=>{},jobId=null,writePage,sequences=owner.materials.sequences,checkpoint=true,sourceIdentities=null}={}){
 const workspace=owner.materials.workspace,commandHash=digest(revisionText(command));
 if(jobId!==null&&!researchId(jobId))throw new AppError('INVALID');
 const file=jobId&&checkpoint?'.observanda/materials/comparison-work/'+jobId+'.json':null;
 writePage??=fn=>workspace.withLock(()=>withWorkspaceMetadataBatch(workspace,fn));
 let resumed=false,state={version:1,commandHash,root:null,last:null,summary:blank(command.comparison),complete:false};
 if(file){const raw=await workspace.readMetadata(file,1048576);if(raw!==null){resumed=true;try{state=JSON.parse(raw);}catch{throw new AppError('MATERIAL_MISSING');}if(state?.commandHash!==commandHash)throw new AppError('MATERIAL_CHANGED');}}
 const sourceRows=[];for(const source of command.comparison.sources)sourceRows.push((await owner.inputs.read(source.dataset)).content.rowCount);
 if(command.comparison.version>=2){validateComparisonSourceIdentities(command.comparison,sourceIdentities,'ANALYSIS_INVALID');if(!resumed){state.summary.sourceRows=sourceRows;state.summary.sourceIdentities=sourceIdentities;}}
 validateCheckpoint(state,command,sourceRows,sourceIdentities);
 const index=new ComparisonIndex(sequences,state.root),total=sourceRows.reduce((a,b)=>a+b,0);
 const append=comparisonAccumulator(index,state,command.comparison);
 async function retain(batch){await owner.verifyInputs();await writePage(async()=>{signal?.throwIfAborted();await owner.verifyInputs();for(const observation of batch){signal?.throwIfAborted();await append(observation);}state.root=await index.flush();await owner.verifyInputs();if(file)await workspace.writeMetadata(file,serialize(state));});}
 if(!state.complete){
  let batch=[],bytes=0;
  for await(const observation of analysisObservations(owner.inputs,command.comparison,{signal,start:state.last})){
   const size=Buffer.byteLength(serialize(observation));if(batch.length&&(batch.length===32||bytes+size>262144)){await retain(batch);await progress({stage:messages.comparingStage,done:state.summary.rows,total});batch=[];bytes=0;}
   batch.push(observation);bytes+=size;
  }
  if(batch.length)await retain(batch);signal?.throwIfAborted();
  if(command.comparison.expected)state.summary.verification=await owner.verifyExpected(command.comparison,{signal});
  state.complete=true;await retain([]);
 }
 if(state.summary.rows!==total)throw new AppError('MATERIAL_MISSING');
 await owner.verifyInputs();await progress({stage:messages.retainingStage,done:total,total});
 return {commandHash,...(file?{workId:jobId}:{}),content:{inputs:owner.references(command.method,command.comparison),tool:command.tool,version:command.version,parameters:'',method:command.method,comparison:command.comparison,summary:{...state.summary,index:{version:1,root:state.root}}}};
}
