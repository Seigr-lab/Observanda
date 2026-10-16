import {sourceKey} from './adapters.js';
import {migrationMessage} from './messages.js';
import {checkSourceSignal} from './source-files.js';

// Each relationship is visited once. A late missing dependency must not cause
// a whole-inventory scan for every predecessor in a long derivation chain.
export function propagateInventoryFailures(objects,objectIssue,{signal}={}){
 const dependents=new Map(),pending=[],seen=new Set();
 for(const object of objects){
  checkSourceSignal(signal);
  if(object.status!=='mapped')pending.push(sourceKey(object));
  if(object.disposition!=='map')continue;
  for(const link of object.links){
   if(!link.required)continue;
   const key=sourceKey(link);if(!dependents.has(key))dependents.set(key,[]);
   dependents.get(key).push({object,link});
  }
 }
 for(let index=0;index<pending.length;index++){
  checkSourceSignal(signal);const key=pending[index];if(seen.has(key))continue;seen.add(key);
  for(const {object,link} of dependents.get(key)??[]){
   if(object.status!=='mapped')continue;
   objectIssue(object,'dependency',migrationMessage('requiredTarget',link));pending.push(sourceKey(object));
  }
 }
}
