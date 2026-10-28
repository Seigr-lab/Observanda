import {archiveDatabaseFixture} from './archive-database-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,open,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {seal} from '../src/encryption.js';
import {writeCatalogueArchive,readCatalogueArchive,inspectCatalogueArchive} from '../src/postgres-archive.js';
import {withOperationProgress} from '../src/operation-progress.js';
import {cataloguePayloadRows} from '../src/catalogue-payload-rows.js';
const hash=value=>createHash('sha256').update(value).digest('hex'),tables={state:['slot','payload']};
test('archive headers restore each guarded catalogue generation',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-archive-generation-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'archive');
 for(const generation of [8,9,10,11,12,13,14,15,16,17,18,19,20,21,23,26]){
  const payload=seal(Buffer.from('Synthetic state'),randomBytes(32),'test');let restored=generation;
  const db={async *rows(){yield {slot:'head',payload_bytes:payload.length};},all:async sql=>sql==='SELECT version FROM catalogue_format'?[{version:restored}]:[{slot:'head',payload}],get:async()=>({found:1}),run:async(sql,value)=>{if(sql.startsWith('UPDATE catalogue_format'))restored=value;}};
  archiveDatabaseFixture(db);const handle=await open(file,'w');try{await writeCatalogueArchive(db,handle,tables);}finally{await handle.close();}restored=3;
  await readCatalogueArchive(file,db,tables);assert.equal(restored,generation);
  if(generation===23){
   const raw=await readFile(file,'utf8'),lines=raw.trimEnd().split('\n'),header=JSON.parse(lines[0]);assert.equal(header.version,5);assert.deepEqual(header.domains,[]);
   for(const bad of [{...header,version:4},{...header,version:3},{...header,catalogueVersion:22},{...header,domains:['unknown']},{...header,domains:['planning','planning']}]){
    await writeFile(file,JSON.stringify(bad)+'\n'+lines.slice(1).join('\n')+'\n');await assert.rejects(readCatalogueArchive(file,db,tables),{code:'CATALOGUE_DAMAGED'});
   }
  }
 }
});
test('chunked archive round-trips encrypted rows and still reads the original archive format',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-archive-format-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'backup'),payload=seal(Buffer.alloc(3*1024*1024+13,65),randomBytes(32),'test'),written=[];
 const db={async *rows(sql,args,options){assert.equal(options.batchSize,32);assert.match(sql,/octet_length/);yield {slot:'head',payload_bytes:payload.length};},async all(sql){return sql==='SELECT version FROM catalogue_format'?[{version:3}]:[{slot:'head',payload}];},async run(sql,...values){written.push(values);},async get(){return {found:1};}};
 archiveDatabaseFixture(db);const handle=await open(file,'wx');try{await writeCatalogueArchive(db,handle,tables);}finally{await handle.close();}
 const raw=await readFile(file,'utf8'),rows=raw.trimEnd().split('\n');assert.ok(rows.every(line=>Buffer.byteLength(line)<1.4*1024*1024));
 await readCatalogueArchive(file,db,tables);assert.deepEqual(written,[['head',payload]]);
 const oldRow=JSON.stringify({table:'state',values:['head',payload.toString('base64')]})+'\n';
 await writeFile(file,JSON.stringify({format:'observanda-postgresql-archive',version:1})+'\n'+oldRow+JSON.stringify({end:true,rows:1,digest:hash(oldRow)})+'\n');written.length=0;
 await readCatalogueArchive(file,db,tables);assert.deepEqual(written,[['head',payload]]);
 // Recompute the archive digest so the row-level checks have to catch damage.
 const invalids=[
  values=>{values[1].bytes=256*1024*1024+1;},
  values=>{values[1].sha256='0'.repeat(64);},
  values=>{values[2].chunk=values[2].chunk.slice(4);},
  values=>{values.splice(3,1);},
  values=>{values[1].table='state; DROP SCHEMA public';},
  values=>{values.splice(values.length-2,1);},
  values=>{values.at(-1).rows++;}
 ];
 for(const alter of invalids){
  const values=rows.map(line=>JSON.parse(line));alter(values);const body=values.slice(1,-1).map(v=>JSON.stringify(v)+'\n').join('');values.at(-1).digest=hash(body);
  await writeFile(file,JSON.stringify(values[0])+'\n'+body+JSON.stringify(values.at(-1))+'\n');
  await assert.rejects(readCatalogueArchive(file,db,tables),{code:'CATALOGUE_DAMAGED'});
 }
 await writeFile(file,raw.slice(0,-1));await assert.rejects(readCatalogueArchive(file,db,tables),{code:'CATALOGUE_DAMAGED'});
});

test('archive transport batches small encrypted rows and isolates large originals without omitting rows',async()=>{
 const source=Array.from({length:81},(_,i)=>({slot:'item-'+String(i).padStart(3,'0'),payload:Buffer.alloc(i===40?2*1024*1024:16384,i)}));
 const batches=[],db={
  async *rows(){for(const row of source)yield {slot:row.slot,payload_bytes:row.payload.length};},
  async all(sql,...ids){const rows=source.filter(row=>ids.includes(row.slot));batches.push(rows);return rows.toReversed();}
 };
 assert.deepEqual(await Array.fromAsync(cataloguePayloadRows(db,'state',['slot','payload'])),source);
 assert.ok(batches.length<10);assert.ok(batches.every(rows=>rows.length<=32&&(rows.length===1||rows.reduce((n,r)=>n+r.payload.length,0)<=256*1024)));
 assert.equal(batches.find(rows=>rows.some(row=>row.slot===source[40].slot)).length,1);
 db.all=async()=>[];await assert.rejects(Array.fromAsync(cataloguePayloadRows(db,'state',['slot','payload'])),{code:'CATALOGUE_DAMAGED'});
});


test('small catalogue payloads use a bounded byte budget and stop fetching when the consumer leaves',async()=>{
 const source=Array.from({length:1024},(_,i)=>({slot:'item-'+String(i).padStart(4,'0'),payload:Buffer.alloc(128,i%256)}));
 let fetched=0,visited=0,closed=false;
 const db={
  async *rows(){try{for(const row of source){visited++;yield {slot:row.slot,payload_bytes:row.payload.length};}}finally{closed=true;}},
  async all(sql,...ids){
   fetched++;assert.ok(ids.length<=256);assert.ok(Buffer.byteLength(sql)<16*1024);
   return source.filter(row=>ids.includes(row.slot)).toReversed();
  }
 };
 assert.deepEqual(await Array.fromAsync(cataloguePayloadRows(db,'state',['slot','payload'])),source);
 assert.ok(fetched<=8,'small payload transport must not require a query for every 32 rows');assert.equal(visited,source.length);assert.equal(closed,true);
 fetched=0;visited=0;closed=false;
 for await(const row of cataloguePayloadRows(db,'state',['slot','payload'])){assert.deepEqual(row,source[0]);break;}
 assert.equal(fetched,1);assert.ok(visited<source.length);assert.equal(closed,true);
});

test('archive and comparison stream rows once without a preliminary count scan',async()=>{
 const rows=Array.from({length:70},(_,i)=>({slot:i?'item-'+i:'head',payload:seal(Buffer.from('row '+i),randomBytes(32),'test')}));
 let visited=0;
 const db={
  get:async()=>{throw Object.assign(Error('count scan timed out'),{code:'57014'});},
  all:async(sql,...ids)=>sql==='SELECT version FROM catalogue_format'?[{version:3}]:rows.filter(row=>ids.includes(row.slot)),
  async *rows(){for(const row of rows){visited++;yield {slot:row.slot,payload_bytes:row.payload.length};}}
 };
 archiveDatabaseFixture(db);const outputs=[];
 for(const options of [{},{stage:'compare-database',tableStage:'compare-database-table'},{observe:false}]){
  const events=[],parts=[];visited=0;
  await withOperationProgress(event=>events.push(event),()=>writeCatalogueArchive(db,{writeFile:async value=>parts.push(value)},tables,options));
  assert.equal(visited,rows.length);outputs.push(parts.join(''));
  if(options.observe!==false){
   const observations=events.filter(event=>event.stage===(options.tableStage??'archive-table'));
   assert.equal(observations[0].total,undefined);
   assert.equal(observations.at(-1).total,rows.length);
   assert.equal(observations.at(-1).completed,rows.length);
  }
 }
 assert.equal(outputs[0],outputs[1]);assert.equal(outputs[0],outputs[2]);
 assert.equal(JSON.parse(outputs[0].trimEnd().split('\n').at(-1)).rows,rows.length);
});

test('read-only archive inspection requires exact file identity and complete validated framing',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-archive-inspect-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'archive'),payload=seal(Buffer.from('Synthetic state'),randomBytes(32),'test');
 const body=JSON.stringify({table:'state',values:['head',payload.toString('base64')]})+'\n';
 const raw=JSON.stringify({format:'observanda-postgresql-archive',version:1})+'\n'+body+JSON.stringify({end:true,rows:1,digest:hash(body)})+'\n';
 await writeFile(file,raw);const found=[];await inspectCatalogueArchive(file,tables,{row:(domain,table,values)=>found.push({domain,table,values})},{expectedDigest:hash(raw)});
 assert.deepEqual(found,[{domain:null,table:'state',values:['head',payload]}]);assert.equal(await readFile(file,'utf8'),raw);
 await assert.rejects(inspectCatalogueArchive(file,tables,{row(){}},{expectedDigest:'0'.repeat(64)}),{code:'CATALOGUE_DAMAGED'});
 for(const bad of [raw.slice(0,-1),raw.replace('"rows":1','"rows":2'),raw.replace('"head"','"other"')]){
  await writeFile(file,bad);await assert.rejects(inspectCatalogueArchive(file,tables,{row(){}},{expectedDigest:hash(bad)}),{code:'CATALOGUE_DAMAGED'});
 }
});
