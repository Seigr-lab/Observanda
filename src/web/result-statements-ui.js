import {retainedTableAction} from './retained-table-reader.js';
import {atext as a} from './analysis-fields-ui.js';
// Result statements are written through the record page's value editors; this opens their sources and retained tables.
export function resultStatementsUI({api,esc,openReference}){
 const reference=r=>`<button type="button" class="text-button" data-action="result-reference" data-ref="${esc(JSON.stringify(r))}">${esc(r.label??a('resultSource'))} · ${r.revision.slice(0,12)}</button>`;
 async function action(b){
  if(await retainedTableAction(b,{api,esc}))return true;
  const name=b.dataset.action;if(!name?.startsWith('result-'))return false;
  if(name==='result-reference'){await openReference(JSON.parse(b.dataset.ref));return true;}
  return true;
 }
 return {action,reference};
}
