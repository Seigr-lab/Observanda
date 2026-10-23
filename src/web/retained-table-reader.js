import {paintRetainedTable} from './retained-table-ui.js';
import {materialReferenceReader} from './material-reference-requests.js';
export async function retainedTableAction(control,{api,esc}){
 if(control.dataset.action!=='retained-table-open')return false;
 const owner=control.closest('[data-retained-ref]');if(!owner)return true;
 const ref=JSON.parse(owner.dataset.retainedRef),table=JSON.parse(owner.dataset.retainedTable),root=owner.querySelector('[data-retained-window]');
 const call=materialReferenceReader({api,local:(name,data,options)=>api('/api/research/materials/'+name,data,{...options,adopt:false})});
 control.disabled=true;try{await paintRetainedTable(root,{call,ref,table,esc});}finally{if(control.isConnected)control.disabled=false;}return true;
}
