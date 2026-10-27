// Scoped observations of completed work. Concurrent operations never share
// counters; unknown totals stay unknown. Heartbeats do not advance these values.
import {AsyncLocalStorage} from 'node:async_hooks';
import {diagnosticPhase} from './operational-diagnostics.js';
const context=new AsyncLocalStorage();
const empty=()=>({objects:0,bytes:0});
function publish(scope,force=false){
 const {root}=scope,now=Date.now();if(!force&&now-root.sentAt<250)return;
 root.sentAt=now;const stages=[];for(let item=scope;item;item=item.parent)stages.unshift(item.stage);
 root.onProgress({stage:scope.stage,stages,completed:scope.completed,unit:scope.unit,...(scope.total===undefined?{}:{total:scope.total}),...(scope.item?{item:scope.item}:{}),...(root.transfer?{transfer:{...root.transfer}}:{}),...(scope.sequences?.length?{sequences:structuredClone(scope.sequences)}:{}),activity:{...scope.activity},elapsedMs:now-root.startedAt,advancedAt:root.advancedAt,observedAt:now});
}
// Transfer totals count destination writes, never inventory or verification
// reads. They survive nested stages and are scoped to this one operation.
export function operationTransfer(update){const scope=context.getStore();if(!scope)return;if(update===null)delete scope.root.transfer;else scope.root.transfer={...scope.root.transfer,...update};publish(scope,true);}
export function operationTransferred({bytes=0,files=0}={}){const scope=context.getStore(),value=scope?.root.transfer;if(!value)return;value.bytes+=bytes;value.files+=files;publish(scope,!!files);}
export function withOperationProgress(onProgress,operation){
 if(!onProgress||context.getStore())return operation();
 const now=Date.now(),root={onProgress,startedAt:now,advancedAt:now,sentAt:0};
 const scope={root,stage:'preparing',completed:0,unit:'items',activity:empty()};
 return context.run(scope,()=>{publish(scope,true);return operation();});
}
export function operationStage(stage,options,operation){return diagnosticPhase(stage,()=>progressStage(stage,options,operation));}
async function progressStage(stage,{total,unit='items',item}={},operation){
 const parent=context.getStore();if(!parent)return operation();
 const scope={root:parent.root,parent,stage,completed:0,total,unit,item,sequences:parent.sequences,activity:empty()};
 const steps=(parent.sequences??[]).flatMap(sequence=>sequence.steps).filter(step=>step.stage===stage&&step.state==='pending');
 for(const step of steps)step.state='running';
 scope.root.advancedAt=Date.now();publish(scope,true);
 let complete=false;try{const result=await context.run(scope,operation);complete=true;return result;}
 finally{for(const step of steps)step.state=complete?'completed':'failed';publish(scope,true);publish(parent,true);}
}
// Report a measured total once streaming work has established it.
export function operationTotal(total){const scope=context.getStore();if(!scope)return;if(!Number.isSafeInteger(total)||total<scope.completed)throw new RangeError('Invalid measured total');scope.total=total;publish(scope,true);}
export function operationAdvance(count=1,stage){const scope=context.getStore();if(!scope||stage&&scope.stage!==stage)return;scope.completed+=count;scope.root.advancedAt=Date.now();publish(scope);}
export function operationItem(item){const scope=context.getStore();if(!scope)return;scope.item=item;publish(scope,true);}
export function operationWork({objects=0,bytes=0}={}){
 const scope=context.getStore();if(!scope)return;
 for(let item=scope;item;item=item.parent){item.activity.objects+=objects;item.activity.bytes+=bytes;}
 if(objects||bytes)scope.root.advancedAt=Date.now();publish(scope);
}

// Owners declare the steps they will attempt; nested checks retain their place
// in the enclosing task. Step counts describe sequence, never elapsed work.
export async function operationSequence(id,stages,operation){
 const parent=context.getStore();if(!parent)return operation();
 if(!stages.length||new Set(stages).size!==stages.length)throw new RangeError('Invalid operation sequence');
 const sequence={id,steps:stages.map(stage=>({stage,state:'pending'}))},scope={...parent,sequences:[...(parent.sequences??[]),sequence]};
 return context.run(scope,async()=>{publish(scope,true);const result=await operation();for(const step of sequence.steps)if(step.state==='pending')step.state='skipped';publish(scope,true);return result;});
}
