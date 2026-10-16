import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {workspaceModules} from '../src/modules/index.js';
import {blankBOM,bomLine} from '../src/web/modules/bom-model.js';
import {balance} from '../src/web/modules/quantities.js';
import {readBOMTable,suggestedBOMMapping,mapBOMTable,BOM_IMPORT_BYTES} from '../src/web/modules/bom-import-model.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {readBOMSource} from '../src/bom-import.js';

for(const count of [20,200])test(count+'-line BOM import, reservation and actual use retain exact independent stock balances',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-bom-growth-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),modules=workspaceModules(f.workspace),base=(await f.workspace.read()).book;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const command=(action,payload,commandId=randomUUID())=>modules.execute({workspaceId:base.id,commandId,action,payload});
 const ids=Array.from({length:count},()=>randomUUID()),id=randomUUID(),material=new ResearchMaterials(f.workspace);
 const headings=['Reference','Value','Qty',...Array.from({length:61},(_,i)=>'Unmapped '+i)],row=n=>['R'+(n+1),'Component '+n,'1',...Array(61).fill('Original source metadata')].join(',');
 const csv=headings.join(',')+'\n'+Array.from({length:count},(_,i)=>row(i)).join('\n'),bytes=Buffer.from(csv);assert.ok(bytes.length<BOM_IMPORT_BYTES);
 let peakHeap=0;const sampler=setInterval(()=>{peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);},25);sampler.unref();
 try{
  let start=performance.now();const upload=await material.startImport({recordId:base.entries[0].id,name:'prototype.csv',size:bytes.length});await material.appendImport(upload.id,0,[bytes]);const artifact=await material.finishImport(upload.id),original=await readBOMSource(f.workspace,{artifact});
  const mapping=suggestedBOMMapping(original.table),mapped=mapBOMTable(original.table,mapping),importMs=performance.now()-start;assert.equal(mapped.lines.length,count);assert.equal(mapped.unmapped.length,61);assert.ok(importMs<10000);
  start=performance.now();for(const [i,resourceId] of ids.entries())await command('resource.create',{id:resourceId,data:{projectId:null,placementId:null,name:'Component '+i,code:'P'+i,kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]},openingStock:{quantity:'100',projectId:null}});
  const setupMs=performance.now()-start;assert.ok(setupMs<120000);
  const lines=mapped.lines.map(({row,...value},i)=>({...bomLine(),...value,resourceId:ids[i]}));
  const source={version:1,artifact:original.artifact,name:original.name,size:original.size,sha256:original.sha256,delimiter:original.table.delimiter,mapping,referenceSeparator:','};
  await command('bom.save',{id,expectedRevision:null,data:{...blankBOM(),title:'Complete prototype plan',recordId:base.entries[0].id,buildCount:'2',lines,source}});
  const before=await modules.current();
  await assert.rejects(command('bom.save',{id,expectedRevision:1,data:{...before.entities.find(e=>e.id===id).data,lines:[...lines,...Array.from({length:201-count},(_,i)=>({...bomLine(),references:'X'+i,value:'Additional part',resourceId:ids[0]}))]}}),{code:'MODULE_INVALID'});
  assert.deepEqual(await modules.current(),before);
  start=performance.now();const reserved=await command('bom.reserve',{id,expectedRevision:1,resources:ids.map(id=>({id,revision:1}))}),reserveMs=performance.now()-start;assert.ok(reserveMs<10000);
  for(const resourceId of ids)assert.deepEqual(balance(reserved.data.entities,resourceId),{physical:'100',reserved:'2',available:'98'});
  const usage=lines.map((line,i)=>({lineId:line.id,used:'1',scrapped:i%2?'0':'1'})),receipt=randomUUID(),payload={id,expectedRevision:2,usage};
  start=performance.now();const finished=await command('bom.finish',payload,receipt),finishMs=performance.now()-start;assert.ok(finishMs<10000);
  for(const [i,resourceId] of ids.entries()){const physical=i%2?'99':'98';assert.deepEqual(balance(finished.data.entities,resourceId),{physical,reserved:'0',available:physical});}
  assert.equal((await command('bom.finish',payload,receipt)).replayed,true);
  const current=await modules.current(),sorted=data=>({...data,entities:[...data.entities].sort((a,b)=>a.id.localeCompare(b.id))});assert.deepEqual(sorted(current),sorted(finished.data));
  assert.deepEqual(current.entities.find(e=>e.id===id).data.source,source);
  await f.workspace.catalogue(store=>modules.verifyCatalogue(store,base.id));
  assert.deepEqual((await f.workspace.read()).book.entries,base.entries);
  assert.ok(peakHeap<256*1024*1024);
  t.diagnostic(JSON.stringify({count,sourceBytes:bytes.length,columns:64,importMs:Math.round(importMs),setupMs:Math.round(setupMs),reserveMs:Math.round(reserveMs),finishMs:Math.round(finishMs),sampledHeapMiB:Math.round(peakHeap/1024**2)}));
 }finally{clearInterval(sampler);}
});

test('BOM import accepts its exact byte and column boundary and rejects the next byte or column without truncation',()=>{
 const prefix='Value,Qty,Unmapped\nPart,1,',text=prefix+'x'.repeat(BOM_IMPORT_BYTES-Buffer.byteLength(prefix));
 const table=readBOMTable(text);assert.equal(table.rows[0].cells[2].length,BOM_IMPORT_BYTES-Buffer.byteLength(prefix));assert.equal(mapBOMTable(table,suggestedBOMMapping(table)).lines.length,1);
 assert.throws(()=>readBOMTable(text+'x'),/1 MiB/);
 const header=Array.from({length:65},(_,i)=>'Column '+i).join(','),row=Array(65).fill('value').join(',');assert.throws(()=>readBOMTable(header+'\n'+row),/64 columns/);
});
