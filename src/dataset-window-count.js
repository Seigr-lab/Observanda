import {AppError} from './errors.js';
import {CellComputationError,resolveCellComputation,derivedCellComputation} from './web/measurement-computation.js';
import {windowDisposition} from './web/dataset-window-model.js';
import {EvaluationPageCache} from './evaluation-page-cache.js';
import {revisionText} from './web/revision-model.js';
import {diagnosticCount} from './operational-diagnostics.js';

export const WINDOW_COUNT_BLOCK=64;
function member(raw,column,window,{tracked,alignment}){
 if(raw.coordinateAlignment!==undefined)throw new AppError(alignment?'MATERIAL_MISSING':'DATASET_CALCULATION');
 const cell=tracked?{...raw,computation:raw.boundary?null:resolveCellComputation(column,raw)}:raw,disposition=windowDisposition(cell,column,window);
 if(disposition.policy==='error')throw new AppError('DATASET_WINDOW_VALUE');
 return {count:disposition.used?1:0,propagated:!disposition.used&&disposition.policy==='propagate',approximate:disposition.used&&tracked&&derivedCellComputation({computation:null},cell).computation!==null};
}
const empty=()=>({count:0,propagated:false,approximate:false});
function merge(target,value){target.count+=value.count;target.propagated||=value.propagated;target.approximate||=value.approximate;}
export class WindowCountSummaries{
 constructor(){this.pages=new EvaluationPageCache({maxPages:128,maxBytes:256*1024});}
 async block(key,read,column,window,options){
  let value=this.pages.get(key);if(value)return value;value=empty();
  for(let index=0;index<WINDOW_COUNT_BLOCK;index++){
   options.signal?.throwIfAborted();const raw=await read(index);diagnosticCount('windowCountSummaryMembers');
   try{merge(value,member(raw,column,window,options));}catch(error){if(!(error instanceof AppError)&&!(error instanceof CellComputationError))throw error;value.error={code:error.code,index};break;}
  }
  this.pages.set(key,value,options);return value;
 }
}
function failMember(error){if(error.code==='DATASET_CELL_COMPUTATION')throw new CellComputationError();throw new AppError(error.code);}
export async function calculateCountWindow(node,column,reader,budget,{tracked,alignment,signal,checkpoint}){
 const state=empty(),options={tracked,alignment,signal},key=reader.countSummaries?revisionText([column,node.window.missing,node.window.excluded,tracked,alignment]):null;
 for(let index=0;index<reader.total;){
  await checkpoint();
  const ordinal=reader.start+index,full=reader.countSummaries&&ordinal>=0&&ordinal%WINDOW_COUNT_BLOCK===0&&index+WINDOW_COUNT_BLOCK<=reader.total&&ordinal+WINDOW_COUNT_BLOCK<=reader.doc.content.rowCount;
  // A short remaining budget takes the member interpreter so its refusal keeps
  // the same precedence over an invalid member later in the requested block.
  if(full&&budget.maxOperations-budget.operations>=2*WINDOW_COUNT_BLOCK){
   budget.run(()=>budget.chargeSteps(1));
   const summary=await reader.countSummaries.block(reader.countKey+':'+key+':'+ordinal,i=>reader.at(index+i),column,node.window,options);
   const visits=summary.error?summary.error.index+1:WINDOW_COUNT_BLOCK;
   if(visits>1)budget.run(()=>budget.chargeSteps(2*(visits-1)-1));
   if(summary.error)failMember(summary.error);merge(state,summary);index+=WINDOW_COUNT_BLOCK;
  }else{
   budget.run(()=>budget.step());const value=member(await reader.at(index),column,node.window,options);merge(state,value);index++;
  }
 }
 signal?.throwIfAborted();const cell=state.propagated?{value:'',kind:'absent'}:{value:String(state.count),kind:'string'};
 return tracked?{...cell,computation:state.propagated||!state.approximate?null:{version:1,kind:'approximate-inputs'}}:cell;
}
