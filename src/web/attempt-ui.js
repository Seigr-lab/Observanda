import {attemptReferences} from './attempt-model.js';

// Attempt facts are written through the record page's value editors; this opens the references they pin.
export function attemptUI({esc,openReference,getRecord}){
 const reference=(ref,i)=>'<button type="button" class="text-button" data-action="attempt-open-ref" data-index="'+i+'">'+esc(ref.label)+' · '+esc(ref.revision.slice(0,12))+'</button>';
 async function action(control){
  if(!control.dataset.action?.startsWith('attempt-'))return false;
  const name=control.dataset.action.slice(8),r=getRecord();if(!r)return true;
  if(name==='open-ref'){const ref=attemptReferences(r.attempt)[Number(control.dataset.index)];if(ref)await openReference(ref);return true;}
  return true;
 }
 return {action,reference};
}
