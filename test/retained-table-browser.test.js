import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('src/web');
test('retained table browser keeps off-page column choices and separates the complete selection from preview navigation',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.route('http://retained-table.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><body><main id="table"></main></body></html>'});
   const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))return route.abort();
   return route.fulfill({contentType:pathname.endsWith('.json')?'application/json':'text/javascript',body:await readFile(file)});
  });
  await page.goto('http://retained-table.test/');await page.evaluate(async()=>{
   const {retainedTableUI}=await import('/retained-table-ui.js'),ref={kind:'dataset',id:'11111111-1111-4111-8111-111111111111',revision:'a'.repeat(64)};
   const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));globalThis.calls=[];
   const call=async(name,data)=>{calls.push(structuredClone({name,data}));if(name==='schema')return {items:Array.from({length:Math.min(16,300-data.offset)},(_,i)=>({name:'Column '+(data.offset+i),unit:''})),total:300,next:data.offset+16<300?data.offset+16:null};if(!data.table)return {version:3,selection:data.selection};return {offset:data.offset??0,next:(data.offset??0)+16,columnOffset:data.columnOffset??0,columnCount:2,columnIndices:[1,17],columnNext:null,table:{version:2,selection:{includeExcluded:false},headers:['Column 1','Column 17'],formats:[{representation:'text',radix:10},{representation:'text',radix:10}],rows:[{page:0,row:data.offset??0,cells:['Exact '+(data.offset??0),'10000000000000001'],presence:['value','value'],exclusion:null,cellWindows:[{next:null,total:6},{next:null,total:17}]}]}};};
   globalThis.saved=null;globalThis.ui=retainedTableUI({root:document.querySelector('#table'),call,esc,field:(label,input)=>'<label>'+label+input+'</label>',guard:()=>{},notify:message=>{throw Error(message);},onTable:table=>{saved=table;}});await ui.load(ref);
  });
  assert.equal(await page.locator('[data-table-column]').count(),16);await page.locator('[data-table-all]').uncheck();await page.locator('[data-table-column="1"]').check();await page.locator('[data-schema-page="16"]').click();await page.locator('[data-table-column="17"]').check();await page.locator('[data-table-count]').fill('1205');await page.locator('[data-table-load]').click();
  await page.locator('[data-table-preview] table').first().waitFor();assert.deepEqual(JSON.parse(await page.locator('[data-table-preview] [data-action="material-measurement-inspect"]').first().getAttribute('data-source')).selector,{kind:'cell',page:0,row:0,column:1});assert.deepEqual(await page.evaluate(()=>saved.selection),{columns:[1,17],offset:0,count:1205,includeExcluded:false});
  await page.locator('[data-table-rows="16"]').click();await page.waitForFunction(()=>document.querySelector('[data-table-preview]').textContent.includes('Exact 16'));assert.equal(await page.evaluate(()=>saved.selection.count),1205);
  await page.locator('[data-schema-page="0"]').click();assert.equal(await page.locator('[data-table-column="1"]').isChecked(),true);
  await page.locator('[data-table-all]').check();await page.locator('[data-table-count]').fill('');assert.deepEqual(await page.evaluate(async()=>await ui.read()),{version:3,selection:{columns:'all',offset:0,count:null,includeExcluded:false}});
  assert.equal(await page.evaluate(()=>calls.filter(call=>call.name==='schema').every(call=>call.data.limit===16)),true);
  const switched=await page.evaluate(async()=>{
   const {retainedTableUI}=await import('/retained-table-ui.js'),first={kind:'dataset',id:'11111111-1111-4111-8111-111111111111',revision:'a'.repeat(64)},second={...first,id:'22222222-2222-4222-8222-222222222222'},painted=[];let release;
   const waiting=new Promise(resolve=>{release=resolve;}),table=count=>({version:3,selection:{columns:'all',offset:0,count,includeExcluded:false}}),call=async(name,data)=>{
    if(name==='schema'){if(data.ref.id===first.id)await waiting;return {items:[{name:'Exact',unit:''}],total:1,next:null};}
    painted.push({id:data.ref.id,count:data.table.selection.count});return {offset:0,next:null,columnOffset:0,columnCount:1,columnIndices:[0],columnNext:null,table:{version:2,selection:{includeExcluded:false},headers:['Exact'],formats:[{representation:'text',radix:10}],rows:[]}};
   };
   const view=retainedTableUI({root:document.querySelector('#table'),call,esc:String,field:(label,input)=>label+input,guard:()=>{},notify:message=>{throw Error(message);}}),pending=view.load(first,table(1));await view.load(second,table(2));release();await pending;return painted;
  });assert.deepEqual(switched,[{id:'22222222-2222-4222-8222-222222222222',count:2}]);
  await page.evaluate(async()=>{
   const {paintRetainedTable}=await import('/retained-table-ui.js'),ref={kind:'dataset',id:'11111111-1111-4111-8111-111111111111',revision:'a'.repeat(64)},table={version:3,selection:{columns:'all',offset:0,count:null,includeExcluded:false}};
   globalThis.cursorCalls=[];const call=async(name,data)=>{
    cursorCalls.push(structuredClone(data));
    if(data.cell)return {cursor:data.cell.cursor,value:data.cell.offset?'FINAL_EXACT':'x'.repeat(4096),column:{name:'Long exact cell'},offset:data.cell.offset,total:4107,next:data.cell.offset?null:4096};
    const [direction,number]=(data.cursor??'').split(':'),offset=data.cursor?Number(number)-(direction==='back'?16:0):data.offset,columnOffset=data.columnOffset;
    return {offset,next:offset+16,cursor:'forward:'+offset,nextCursor:'forward:'+(offset+16),previousCursor:offset?'back:'+offset:null,columnOffset,columnCount:16,columnIndices:[columnOffset],columnNext:columnOffset?null:8,table:{version:2,selection:{includeExcluded:false},headers:['Column '+columnOffset],formats:[{representation:'text',radix:10}],rows:[{page:70,row:offset%64,cursor:'forward:'+offset,cells:['Exact '+offset],presence:['value'],exclusion:null,cellWindows:[{next:1024,total:4107}]}]}};
   };
   await paintRetainedTable(document.querySelector('#table'),{call,ref,table,esc:String,offset:12000});
  });
  await page.locator('[data-table-rows="12016"]').click();await page.waitForFunction(()=>document.querySelector('#table').textContent.includes('Exact 12016'));
  await page.locator('[data-table-columns="8"]').click();await page.waitForFunction(()=>document.querySelector('#table th').textContent==='Column 8');
  await page.locator('[data-table-cell-row="12016"]').first().click();await page.locator('[data-cell-offset="4096"]').click();await page.waitForFunction(()=>document.querySelector('[data-table-cell-window] pre').textContent==='FINAL_EXACT');
  await page.locator('[data-table-rows="12000"]').click();await page.waitForFunction(()=>document.querySelector('#table').textContent.includes('Exact 12000'));
  const requests=await page.evaluate(()=>cursorCalls);assert.equal(requests[1].cursor,'forward:12016');assert.equal(requests[1].offset,undefined);assert.equal(requests[2].cursor,'forward:12016');assert.equal(requests[2].columnOffset,8);assert.equal(requests[3].cell.cursor,'forward:12016');assert.equal(requests[4].cell.cursor,'forward:12016');assert.equal(requests[5].cursor,'back:12016');assert.equal(requests[5].offset,undefined);

 }finally{await browser.close();}
});
