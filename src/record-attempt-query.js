// Keep each run fact's text and reference labels at its original position.
// Facts precede all reference labels, matching the complete-record search.
import {attemptFactSearchParts,attemptReferences,emptyAttempt} from './web/attempt-model.js';
import {collectionChanges} from './record-projection-dependency.js';
const groups=['preparations','events','assessments'];
const kind=group=>group==='preparations'?'preparation':group==='events'?'event':'assessment';
const ordinal=value=>String(value).padStart(16,'0');
export function attemptReferenceGroups(project){
 return groups.map(group=>({collection:['attempt',group],fields:group==='preparations'?['basedOn','protocols','conditions','inputs']:['references'],project:value=>attemptReferences({...emptyAttempt(),[group]:[value]}).flatMap(project)}));
}
export async function retainAttemptSearchParts(document,previous,set,{signal}={}){
 let total=0;
 const length=async(source,path)=>source&&await source.reference(path,{signal})?source.tree.arrayLength(source.root,path):0;
 for(const [groupIndex,group] of groups.entries()){
  const path=['attempt',group],after=await length(document,path);total+=after;
  const changes=previous?await collectionChanges(document,previous,path,{signal}):null;if(changes?.unchanged)continue;
  const before=await length(previous,path);
  const positions=changes?changes.positions():(async function*(){for(let i=0;i<Math.max(before,after);i++)yield i;})();
  for await(const position of positions){
   signal?.throwIfAborted();let text=null,labels=null;
   if(position<after){
    const value=(await document.field([...path,String(position)],{signal})).value;
    text=attemptFactSearchParts(kind(group),value).join(' ');
    const references=attemptReferences({...emptyAttempt(),[group]:[value]});if(references.length)labels=references.map(ref=>ref.label).join(' ');
   }
   const suffix=':'+groupIndex+':'+ordinal(position);await set('70:0'+suffix,text);await set('70:1'+suffix,labels);
  }
 }
 // An explicitly empty attempt contributes one empty field; absence does not.
 await set('70',!total&&(await document.field(['attempt','version'],{signal})).found?'':null);
}
