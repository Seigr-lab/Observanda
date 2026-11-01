import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inventoryClient} from '../src/web/modules/inventory-client.js';

test('inventory refresh paints only the current BOM preview and survives discarding its draft',async()=>{
 const previous=globalThis.document,preview={innerHTML:''},closedDialog={innerHTML:'retained dialog'};
 globalThis.document={querySelectorAll:()=>[],querySelector:selector=>selector==='.module-workbench [data-bom-preview]'?preview:selector==='[data-bom-preview]'?closedDialog:null};
 const c={services:{state:{page:'module',moduleId:'resources',book:{id:'workspace',projects:[]},storage:{contextId:'context'}},api:async()=>{throw Error('No resources require a request');}},current:{id:'draft',type:'bom',expectedRevision:null,data:{lines:[]}},snapshot:{revision:0},itemsPage:{items:[]},esc:String,button:()=>'',bindItemLabels:()=>{}};
 const client=inventoryClient(c,{card:()=>'',stock:()=>'',bom:()=> 'current draft'});
 try{
  client.bind();await new Promise(resolve=>setImmediate(resolve));assert.equal(preview.innerHTML,'current draft');assert.equal(closedDialog.innerHTML,'retained dialog');
  c.current=undefined;preview.innerHTML='detached editor';client.bind();await new Promise(resolve=>setImmediate(resolve));assert.equal(preview.innerHTML,'detached editor');assert.equal(closedDialog.innerHTML,'retained dialog');
 }finally{client.stop();globalThis.document=previous;}
});
