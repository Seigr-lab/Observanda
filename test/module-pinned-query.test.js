import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {ModuleReader} from '../src/modules/reader.js';
import {pinnedQueryResults} from '../src/pinned-query-result.js';
import {clearVault} from '../src/encryption.js';
import {queryCacheMemoryFiles} from './fixtures/query-cache-memory.js';
const order=(a,b)=>{const x=a.title.toLowerCase(),y=b.title.toLowerCase();return x<y?-1:x>y?1:a.id<b.id?-1:a.id>b.id?1:0;};
function fixture(count){
 const workspaceId=randomUUID(),workspace={root:path.resolve('synthetic-module-query',workspaceId),vault:{id:randomUUID(),key:randomBytes(32)}},rows=Array.from({length:count},(_,i)=>({id:randomUUID(),type:'resource',title:'Sample '+(count-i),status:'available',tags:[],createdAt:'2026-01-01T00:00:00.000Z'})),members=new Map(rows.map(row=>[row.id,row])),calls={scan:0,view:0,search:0,member:0};
 const context={book:{id:workspaceId,projects:[],notebooks:[]},head:{revision:'a'.repeat(64)},async *members(){calls.scan++;yield* rows;},async member(id){calls.member++;return members.get(id);},async view(member){calls.view++;return member;},async search(member){calls.search++;return member.title.toLowerCase();},encode:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),decode:value=>JSON.parse(Buffer.from(value,'base64url'))};
 const reader=new ModuleReader(workspace,{context:(_id,operation)=>operation(context)});return {workspaceId,workspace,rows,calls,context,reader,reset:()=>Object.keys(calls).forEach(key=>calls[key]=0)};
}
for(const count of [1000,10000])test('residual module pages reuse exact bounded results among '+count+' rows',async t=>{
 t.mock.method(pinnedQueryResults,'open',queryCacheMemoryFiles);const f=fixture(count),query={workspaceId:f.workspaceId,type:'resource',query:'sample',limit:25},expected=[...f.rows].sort(order);
 try{
  const first=await f.reader.list(query);assert.deepEqual(first.items,expected.slice(0,25));assert.equal(first.total,count);assert.deepEqual(f.calls,{scan:1,view:count,search:count,member:0});f.reset();
  const second=await f.reader.list({...query,cursor:first.nextCursor}),third=await f.reader.list({...query,cursor:second.nextCursor});assert.deepEqual(second.items,expected.slice(25,50));assert.deepEqual(third.items,expected.slice(50,75));assert.deepEqual((await f.reader.list({...query,cursor:third.previousCursor})).items,second.items);assert.deepEqual(f.calls,{scan:0,view:0,search:0,member:0});
  f.context.book.projects.push({id:randomUUID(),title:'Changed scope'});await assert.rejects(f.reader.list({...query,cursor:first.nextCursor}),{code:'MODULE_QUERY_CURSOR'});
  t.diagnostic(JSON.stringify({rows:count,page:25,firstSummaryReads:count,repeatedSummaryReads:0,repeatedCandidateScans:0}));
 }finally{await clearVault(f.workspace.vault);}
});
test('explicit module identities retain direct reads and fresh queries revalidate source facts',async t=>{
 let opens=0;t.mock.method(pinnedQueryResults,'open',(...args)=>{opens++;return queryCacheMemoryFiles(...args);});const f=fixture(50),query={workspaceId:f.workspaceId,type:'resource',query:'sample'},selected=f.rows[8];
 try{
  assert.deepEqual((await f.reader.list({...query,keys:[selected.id]})).items,[selected]);assert.deepEqual(f.calls,{scan:0,view:1,search:1,member:1});assert.equal(opens,0);
  await assert.rejects(f.reader.list({...query,keys:[randomUUID()]}),{code:'NOT_FOUND'});
  const first=await f.reader.list(query);await assert.rejects(f.reader.list({...query,query:'other',cursor:first.nextCursor}),{code:'MODULE_QUERY_CURSOR'});
  const original=f.context.view;f.context.view=()=>{throw Object.assign(Error('Corrupt fact'),{code:'CATALOGUE_DAMAGED'});};await assert.rejects(f.reader.list(query),{code:'CATALOGUE_DAMAGED'});f.context.view=original;
 }finally{await clearVault(f.workspace.vault);}
});

for(const projected of [true,false])test('scoped inventory membership preserves zero-stock placements without an ID set '+projected,async t=>{
 t.mock.method(pinnedQueryResults,'open',queryCacheMemoryFiles);const f=fixture(5),place=randomUUID(),other=randomUUID(),[owned,moved,asset,hidden,unplaced]=f.rows,constraints=new Map(f.rows.map(row=>[row.id,{id:row.id,type:'resource',data:{kind:'material',projectId:other}}]));
 constraints.get(owned.id).data.projectId=place;constraints.get(asset.id).data={kind:'equipment',projectId:place,placementId:other};constraints.get(unplaced.id).data.projectId=null;hidden.title='Filtered out';
 const movement={id:randomUUID(),type:'movement',data:{resourceId:moved.id,projectId:place,delta:'0'}};constraints.set(movement.id,movement);const stock=new Set(['scope:'+place+':'+owned.id,'scope:'+place+':'+moved.id,'scope:-:'+unplaced.id]);let proofs=0;
 f.context.constraint=async member=>constraints.get(member.id);f.context.stockProjection=async()=>projected?[{head:{},index:{get:async(_head,key)=>{proofs++;return stock.has(key)?{count:1}:null;},entries(){assert.fail('Resource IDs must not be enumerated into a scope set');}}}]:null;
 f.context.members=async function*({types}={}){for(const member of [...f.rows,movement])if(!types||types.includes(member.type))yield member;};
 try{
  const query={workspaceId:f.workspaceId,type:'resource',moduleId:'resources',scopeIds:[place,null],query:'sample'},first=await f.reader.list(query);assert.deepEqual(new Set(first.items.map(row=>row.id)),new Set([owned.id,moved.id,unplaced.id]));if(projected)assert.ok(proofs<=8);
  const saved=proofs;assert.deepEqual((await f.reader.list({...query,cursor:first.cursor})).items,first.items);assert.equal(proofs,saved);
  // Explicit selections preserve their strict identity contract independently
  // of a resource's current placement, including assets moved elsewhere.
  assert.deepEqual((await f.reader.list({...query,keys:[asset.id]})).items,[asset]);
 }finally{await clearVault(f.workspace.vault);}
});
